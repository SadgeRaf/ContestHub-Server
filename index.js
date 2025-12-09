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
    const winnersCollection = db.collection('Winners');

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

    app.get('/winners', async (req, res) => {
      const result = await winnersCollection.find().sort({ date: -1 }).toArray();
      res.send(result);
    })

    app.post('/winners', async (req, res) => {
      const { name, prize, img } = req.body;

      const newWinner = {
        name,
        prize,
        img: img || null,
        date: new Date(),
      }

      const result = await winnerCollection.insertOne(newWinner);
      res.status(201).send(result);

    })

   app.post('/create-checkout-session', async (req, res) => {
  const paymentInfo = req.body;

  try {
    const amount = Math.round(Number(paymentInfo.prize.toString().replace(/\$/g, "")) * 100);


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

      // MATCH frontend property name
      success_url: `${process.env.SITE_DOMAIN}/contest/${paymentInfo.contestId}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/contest/${paymentInfo.contestId}`,
    });

    res.send({ url: session.url });

  } catch (err) {
    console.error("Stripe error:", err);
    res.status(400).send({ error: err.message });
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
