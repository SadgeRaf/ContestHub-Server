const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE);


const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json())

const serviceAccount = require("./contest-hub-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@bababoey.nqekx8b.mongodb.net/?appName=Bababoey`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const verifyToken = async (req, res, next) => {
  const wholeToken = req.headers.authorization;

  if (!wholeToken) {
    return res.status(401).send({ message: "unauthorized. Token not found" });
  }

  const token = wholeToken.split(" ")[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.user = decodedUser;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(401).send({ message: "unauthorized" });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('Contest-hub');
    const contestCollection = db.collection('Contests');
    const registeredCollection = db.collection("Registered");
    const userCollection = db.collection("Users");

    app.post('/users', async (req, res) => {
      const user = req.body;

      user.role = "user";
      user.createdAt = new Date();

      const existing = await userCollection.findOne({ email: user.email });

      if (existing) {
        return res.send({ status: "exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });


    app.get('/contests', async (req, res) => {

      const result = await contestCollection.find().toArray();

      res.send(result)
    })

    app.get('/bigcontests', async (req, res) => {

      const result = await contestCollection.find().sort({ participations: -1 }).limit(5).toArray();

      res.send(result)
    })

    app.get(`/contest/:id`, async (req, res) => {
      const { id } = req.params;

      const result = await contestCollection.findOne({ _id: new ObjectId(id) });

      res.send(result);
    })

    app.post('/addcontest', async (req, res) => {
      const contest = req.body;
      const result = await contestCollection.insertOne(contest);
      res.send(result);
    })

    app.get("/search", async (req, res) => {
      const type = req.query.type;

      if (!type) {
        return res.send([]);
      }

      const result = await contestCollection
        .find({ type: { $regex: type, $options: "i" } })
        .toArray();

      res.send(result);
    });

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;

      try {
        const amount = parseInt(paymentInfo.fee * 100);

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "USD",
                product_data: { name: paymentInfo.name },
                unit_amount: amount,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.email,
          mode: 'payment',
          metadata: {
            contestId: paymentInfo.contestId,
            userEmail: paymentInfo.email,
            contestName: paymentInfo.name
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/contest/${paymentInfo.contestId}`,
        });

        res.send({ url: session.url });

      } catch (err) {
        console.error("Stripe error:", err);
        res.status(400).send({ error: err.message });
      }
    });

    app.patch('/verify-payment', async (req, res) => {
      const sessionId = req.query.session_id;

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const { contestId, userEmail, contestName } = session.metadata;

        const transactionId = session.payment_intent;
        const query = {
          transactionId: transactionId,
          userEmail: userEmail
        };

        const paymentExist = await registeredCollection.findOne(query);

        if (paymentExist) {
          return res.send({ message: "Already registered", transactionId });
        }

        if (session.payment_status === 'paid') {
          const query = { _id: new ObjectId(contestId) };
          const update = {
            $inc: { participants: 1 },
            $addToSet: { registeredUsers: userEmail }
          };

          const result = await contestCollection.updateOne(query, update);
          await registeredCollection.insertOne({
            contestId,
            userEmail,
            contestName,
            registeredAt: new Date(),
            paymentSession: session.id,
            transactionId: session.payment_intent,
            contestStatus: 'registered'
          });

          return res.send({ success: true, result });
        }

        res.send({ success: false });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/registered', verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        // Check user identity using decoded token
        if (email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden: Email mismatch" });
        }

        // Fetch contests for this user
        const result = await registeredCollection.find({ userEmail: email }).toArray();

        res.send(result);

      } catch (err) {
        console.error("Failed to fetch registered contests:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get('/registered/single', verifyToken, async (req, res) => {
      const { contestId, email } = req.query;

      const record = await registeredCollection.findOne({ contestId, userEmail: email });

      res.send(record || null);
    });

    app.patch("/registered/submit/:id", async (req, res) => {
      const id = req.params.id;
      const { submissionText, submittedAt } = req.body;

      try {
        const registered = await registeredCollection.findOne({
          _id: new ObjectId(id),
        });

        const { contestId, userEmail } = registered;

        const regUpdate = await registeredCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              submission: {
                text: submissionText,
                submittedAt,
              },
              contestStatus: "submitted",
            },
          }
        );

        const contestUpdate = await contestCollection.updateOne(
          { _id: new ObjectId(contestId) },
          {
            $push: {
              submissions: {
                userEmail,
                text: submissionText,
                submittedAt,
              },
            },
          }
        );

        res.send({
          success: true,
          registeredUpdate: regUpdate,
          contestUpdate: contestUpdate,
        });

      } catch (err) {
        res.status(500).send({ success: false, error: err.message });
      }
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error

  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send("Working");
})

app.listen(port, () => {
  console.log(`Running at ${port}`);
})
