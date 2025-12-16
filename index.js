const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();

// Middleware
app.use(cors());
app.use(express.json());

// const verifyFBToken = async (req, res, next) => {
//     const token = req.headers.authorization;

//     if (!token) {
//         return res.status(401).send({ message: 'unauthorized access' })
//     }

//     try {
//         const idToken = token.split(' ')[1];
//         const decoded = await admin.auth().verifyIdToken(idToken);
//         console.log('decoded in the token', decoded);
//         req.decoded_email = decoded.email;
//         next();
//     }
//     catch (err) {
//         return res.status(401).send({ message: 'unauthorized access' })
//     }

// }

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@bdpro.cwpjxwk.mongodb.net/?appName=BDPro`;

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
    const lessonsCollection = db.collection("lessons");
    const userCollection = db.collection("users");

    // user related apis
    app.get("/users", async (req, res) => {
      try {
        const query = req.query;
        const users = await userCollection.find({}).toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

app.get("/user/:email", async (req, res) => {
try {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send(user);
} catch (error) {
  console.log(error);
}
    });

app.get("/users/:email/role", async (req, res) => {
try {
        const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
} catch (error) {
  console.log(error);
}
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });


// profile page related api
app.get('/profile/user/:email', async (req, res) => {
  try {
    const email = req.params.email;

    const lessons = await lessonsCollection
      .find({ email: email })
      .toArray();

    res.send(lessons);
  } catch (error) {
    console.log(error);
    res.status(500).send({ error: "Server error" });
  }
});

    // lessons related apis
    app.get("/lessons", async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;

        // /parcels?email=''&
        if (email) {
          query.email = email;
        }

        const options = { sort: { createdAt: -1 } };

        const cursor = lessonsCollection.find(query, options);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    // lessons related apis
    app.get("/lessons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(lesson);
      } catch (error) {
        console.log(error);
      }
    });
    app.patch("/lessons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const {
          title,
          accessLevel,
          category,
          createdAt,
          description,
          privacy,
          image,
          emotionalTone,
        } = req.body;

        const updatedDoc = {
          $set: {
            title: title,
            accessLevel,
            category,
            createdAt,
            description,
            privacy,
            image,
            emotionalTone,
          },
        };

        const lesson = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          updatedDoc
        );
        res.send(lesson);
      } catch (error) {
        console.log(error);
      }
    });

    app.delete("/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await lessonsCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/lessons", async (req, res) => {
      try {
        const lesson = req.body;

        if (
          !lesson.title ||
          !lesson.description ||
          !lesson.category ||
          !lesson.emotionalTone ||
          !lesson.image ||
          !lesson.accessLevel ||
          !lesson.privacy ||
          !lesson.email
        ) {
          return res.status(400).send({ error: "Required fields missing" });
        }

        lesson.createdAt = new Date();

        const result = await lessonsCollection.insertOne(lesson);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

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
