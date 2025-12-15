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
    const winnersCollection = db.collection("Winners");
    const creatorsCollection = db.collection("Creators");

    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      next();
    }

    app.get('/users', verifyToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

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

    app.patch('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const roleInfo = req.body;

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: roleInfo.role } }
        );

        res.send({
          success: true,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const { name, photo, address, bio } = req.body;

      try {
        const result = await userCollection.updateOne(
          { email },
          {
            $set: {
              name,
              photo,
              address,
              bio,
              updatedAt: new Date(),
            },
          }
        );

        res.send({ success: true, result });
      } catch (err) {
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/users/:email/role', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || 'user' })
    })

    app.get("/winners", async (req, res) => {
      const { winnerEmail } = req.query;
      if (!winnerEmail) return res.send([]);
      const result = await winnersCollection.find({ winnerEmail }).toArray();
      res.send(result);
    });

    app.get("/winners/all", async (req, res) => {
      try {
        const result = await winnersCollection.find().toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/creators', verifyToken, verifyAdmin, async (req, res) => {
      const query = {}
      if (req.query.status) {
        query.status = req.query.status
      }
      const cursor = creatorsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/creators/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const status = req.body.status;
        const query = { _id: new ObjectId(id) };

        const updated = {
          $set: {
            status: status
          }
        }

        const result = await creatorsCollection.updateOne(query, updated);

        if (status === 'approved') {
          const email = req.body.email;
          const userQuery = { email };;
          const updateUser = {
            $set: {
              role: 'creator'
            }
          }
          const userResult = await userCollection.updateOne(userQuery, updateUser);
        }

        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.post('/creators', verifyToken, async (req, res) => {
      try {
        const creator = req.body;
        creator.status = 'pending';
        creator.createdAt = new Date();

        const existing = await creatorsCollection.findOne({ email: creator.email });
        if (existing) {
          return res.send({ status: 'exists', message: 'You have already applied.' });
        }

        const result = await creatorsCollection.insertOne(creator);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/contests', async (req, res) => {
      const result = await contestCollection
        .find({ $or: [{ contestStatus: 'approved' }, { contestStatus: { $exists: false } }] })
        .toArray();
      res.send(result);
    });

    app.get('/bigcontests', async (req, res) => {
      const result = await contestCollection
        .find({ $or: [{ contestStatus: 'approved' }, { contestStatus: { $exists: false } }] })
        .sort({ participations: -1 })
        .limit(5)
        .toArray();
      res.send(result);
    });

    app.get('/contest/:id', async (req, res) => {
      const { id } = req.params;
      const result = await contestCollection.findOne({
        _id: new ObjectId(id),
        $or: [{ contestStatus: 'approved' }, { contestStatus: { $exists: false } }]
      });

      if (!result) return res.status(404).send({ message: 'Contest not found or rejected' });

      res.send(result);
    });

    app.post('/addcontest', verifyToken, async (req, res) => {
      try {
        const contest = req.body;

        contest.contestStatus = 'pending';
        contest.createdAt = new Date();
        contest.updatedAt = new Date();
        contest.creatorId = req.user.uid;
        contest.submissions = [];
        contest.registeredUsers = [];
        contest.winner = null;

        const result = await contestCollection.insertOne(contest);
        res.send({ success: true, result });

      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.patch('/contests/:id', verifyToken, async (req, res) => {
      const { status } = req.body;
      const id = req.params.id;

      const result = await contestCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { contestStatus: status } }
      );

      res.send({ success: true, result });
    });

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

        if (email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden: Email mismatch" });
        }

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

    app.patch("/registered/submit/:id", verifyToken, async (req, res) => {
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

    app.get('/admin/contests/pending', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await contestCollection.find({ contestStatus: 'pending' }).toArray();

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/admin/contests/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await contestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { contestStatus: status } }
        );

        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/creator/contests', verifyToken, async (req, res) => {
      try {
        const creatorId = req.user.uid;
        const contests = await contestCollection
          .find({ creatorId })
          .toArray();

        res.send(contests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.patch('/creator/contest/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const updates = req.body;

      try {
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(id), creatorId: req.user.uid, contestStatus: 'pending' },
          { $set: { ...updates, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(403).send({ message: "Not allowed or contest already approved" });
        }

        res.send({ success: true, result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.delete('/creator/contest/:id', verifyToken, async (req, res) => {
      const id = req.params.id;

      try {
        const result = await contestCollection.deleteOne({
          _id: new ObjectId(id),
          creatorId: req.user.uid,
          contestStatus: 'pending'
        });

        if (result.deletedCount === 0) {
          return res.status(403).send({ message: "Not allowed or contest already approved" });
        }

        res.send({ success: true, message: "Contest deleted" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    app.get('/creator/contests/approved', verifyToken, async (req, res) => {
      try {
        const creatorId = req.user.uid;
        const contests = await contestCollection
          .find({ creatorId, contestStatus: 'approved' })
          .toArray();
        res.send(contests);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/creator/contests/:id/winner', verifyToken, async (req, res) => {
      const contestId = req.params.id;
      const { winnerEmail } = req.body;

      if (!winnerEmail) {
        return res.status(400).send({ message: 'Winner email is required' });
      }

      try {
        // Find the contest and verify it's the creator's contest
        const contest = await contestCollection.findOne({
          _id: new ObjectId(contestId),
          creatorId: req.user.uid,
          contestStatus: 'approved'
        });

        if (!contest) {
          return res.status(403).send({ message: 'Not allowed or contest not approved' });
        }

        // Verify that the winner email exists in submissions
        const submissionExists = contest.submissions.some(
          (sub) => sub.userEmail === winnerEmail
        );

        if (!submissionExists) {
          return res.status(400).send({ message: 'This user did not submit for the contest' });
        }

        // Update contest with winner
        await contestCollection.updateOne(
          { _id: new ObjectId(contestId) },
          {
            $set: {
              winner: winnerEmail,
              contestStatus: 'completed',
              updatedAt: new Date()
            }
          }
        );

        // Insert into winnersCollection for homepage showcase
        await winnersCollection.insertOne({
          contestId,
          contestName: contest.name,
          winnerEmail,
          prize: contest.prize,
          createdAt: new Date(),
          contestType: contest.type,
          banner: contest.banner
        });

        res.send({ success: true, message: 'Winner selected successfully' });
      } catch (err) {
        console.error(err);
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
