const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

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
