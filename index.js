const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();

// Middleware
app.use(cors());
app.use(express.json());

const uri =
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@bdpro.cwpjxwk.mongodb.net/?appName=BDPro`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


async function run() {
  try {
    await client.connect();
    const db = client.db("life-lessons");
    const userCollection = db.collection("users");

    app.get("/users", async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      const cursor = userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post('/users', async(req,res)=>{
      const user = req.body;
      user.createdAt = new Date()
      const email = user.email;
      const userExists = await userCollection.findOne({email})

      if(userExists)
      {
        return res.send({message: 'user exists'})
      }

      const result = await userCollection.insertOne(user)
      res.send(result)
    })





















    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    
  }
}
run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// Start server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
