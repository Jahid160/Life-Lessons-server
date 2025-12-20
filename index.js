const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");

const serviceAccount = require("./digital-life-lessons-firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

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
    const lessonReportsCollection = db.collection("lessonReports");
    const paymentCollection = db.collection("payment");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // users related apis
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        // query.displayName = {$regex: searchText, $options: 'i'}

        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const cursor = userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.get("/users/:email", async (req, res) => {
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
      user.role = "user";
      user.isPremium = "false";
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // profile page related api
    app.get("/profile/user/:email", async (req, res) => {
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

    // admin profile name and image change api
    app.patch(
      "/users/profile",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { photoURL, displayName } = req.body;
          console.log("admin profile patch", photoURL, displayName);
          updatedDoc = {};
          const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                displayName: displayName,
                photoURL: photoURL,
              },
            }
          );
          res.send(result);
        } catch (error) {
          console.log(error);
        }
      }
    );

    // create payment
    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const { price } = req.body;

        const email = req.decoded_email;
        console.log(email);

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "bdt",
                product_data: {
                  name: "Premium Lifetime Access",
                },
                unit_amount: price * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: email,
          mode: "payment",
          payment_method_types: ["card"],
          metadata: {
            email: email,
          },
          success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_DOMAIN}/payment-cancel`,
        });
        res.send({ url: session.url, id: session.id });
      } catch (error) {
        console.error("Stripe error:", error.message);
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      const { email, sessionId } = req.body;
      // console.log(email);

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);

      const userInfo = await userCollection.findOne({ email });

      const userOrder = await paymentCollection.findOne({
        transactionId: session.payment_intent,
      });

      if (session.payment_status === "paid" && userInfo && !userOrder) {
        const email = session.metadata?.email;
        const userOrderData = {
          email: session.metadata?.email,
          transactionId: session.payment_intent,
          status: "paid",
          price: session.amount_total / 100,
          createdAt: new Date(),
        };
        await paymentCollection.insertOne(userOrderData);
        const updateResult = await userCollection.updateOne(
          { email },
          { $set: { isPremium: true } }
        );

        console.log(updateResult);
      }
    });

    // POST: Create lesson report user

    app.post("/lessonReports", async (req, res) => {
      try {
        const {
          lessonId,
          reportedLessonTitle,
          reporterUserId,
          reportedUserEmail,
          reason,
          createdAt,
        } = req.body;

        if (!lessonId || !reporterUserId || !reason) {
          return res.status(400).send({
            message: "Missing required fields",
          });
        }

        // stop existingReport same user
        const existingReport = await lessonReportsCollection.findOne({
          lessonId,
          reporterUserId,
        });

        if (existingReport) {
          return res.status(409).send({
            message: "You have already reported this lesson",
          });
        }

        const reportDoc = {
          lessonId,
          reportedLessonTitle,
          reporterUserId,
          reportedUserEmail,
          reason,
          status: "pending", // pending | reviewed | resolved
          createdAt: createdAt || new Date().toISOString(),
        };

        const result = await lessonReportsCollection.insertOne(reportDoc);

        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // GET: All reports (Admin)

    app.get("/lessonReports", verifyFBToken, verifyAdmin, async (req, res) => {
      const reports = await lessonReportsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(reports);
    });

    // PATCH: Update report status (Admin)

    app.patch(
      "/lessonReports/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const result = await lessonReportsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { status },
          }
        );

        res.send(result);
      }
    );

    // DELETE: Remove report (Admin)

    app.delete(
      "/lessonReports/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;

        const result = await lessonReportsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      }
    );

    app.get("/lessons/user/:email", async (req, res) => {
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
    app.get("/lessons", verifyFBToken, async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;

        // /parcels?email=''&
        if (email) {
          query.email = email;
        }

        const options = { sort: { createdAt: -1 } };

        const cursor = lessonsCollection.find(query, options);
        // console.log('headers in the middleware', req.headers.authorization);
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

    // lesson update
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

    // lesson delete
    app.delete("/lessons/:id", verifyFBToken, async (req, res) => {
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
