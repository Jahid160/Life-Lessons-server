const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");



// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  // console.log(token);

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded
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
    const saveCollection = db.collection("save");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // verify isPremium
    // const verifyPremium = async (req, res, next) => {
    //   const user = await userCollection.findOne({ email: req.decoded.email });

    //   if (!user?.isPremium) {
    //     return res.status(403).send({ message: "Premium only" });
    //   }

    //   next();
    // };

    // dashboard user api
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
        console.log(email);
        const user = await userCollection.findOne(query);
        res.send(user);
      } catch (error) {
        console.log(error);
      }
    });

    // isPremium user
    // app.get("/users/isPremium", verifyFBToken, async (req, res) => {

    //  try {
    // const email = req.decoded_email;
    // console.log(email);

    //   const user = await userCollection.findOne({email});
    //         res.send(user);
    //       } catch (error) {
    //       console.log(error);
    // }
    // });

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
  try {
    const user = req.body;
    user.createdAt = new Date();
    user.role = "user";
    user.isPremium = false;

    const existingUser = await userCollection.findOne({ email: user.email });
    if (existingUser) {
      return res.send({ message: "User already exists" });
    }

    const result = await userCollection.insertOne(user);
    res.send({ success: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error: error.message });
  }
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
    
    // user profile summary api
    app.get("/profile/summary", verifyFBToken, async (req, res) => {
  const userId = req.user.uid;
  const email = req.decoded_email

  const lessonsCreated = await lessonsCollection.countDocuments({
    email: email,
    
  });

  const lessonsSaved = await saveCollection.countDocuments({
    userId,
  });

  const user = await userCollection.findOne({ email: email });

  res.json({
    lessonsCreated,
    lessonsSaved,
    isPremium: user?.isPremium || false,
  });
});
// app.get("/profile/lessons", verifyFBToken, async (req, res) => {
//   const userId = req.user.uid;

//   const lessons = await lessonsCollection
//     .find({
//       creatorId: userId,
//       accessLevel: "Public",
//     })
//     .sort({ createdAt: -1 })
//     .toArray();

//   res.json(lessons);
// });


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
app.get("/lessons", async (req, res) => {
  try {
    const query = {};
    const { email, page = 1, limit = 8 } = req.query;

    // filter by email if provided
    if (email) {
      query.email = email;
    }

    const skip = (Number(page) - 1) * Number(limit);

    // total lessons count (for pagination)
    const total = await lessonsCollection.countDocuments(query);

    // get paginated lessons
    const lessons = await lessonsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .toArray();

    res.send({
      lessons,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});


app.get("/lessonsAdmin", verifyFBToken, async (req, res) => {
  try {
    const { email } = req.query; // optional email filter
    const query = {};

    if (email) {
      query.email = email; // filter by user email
    }

    const lessons = await lessonsCollection.find(query).sort({ createdAt: -1 }).toArray();

    // Always return an array
    res.status(200).json(lessons);
  } catch (error) {
    console.error("Error fetching lessons:", error);
    res.status(500).json({ message: "Failed to fetch lessons", error });
  }
});

    // lessons banner api
app.get("/banner", async (req, res) => {
  try {
    const result = await lessonsCollection
      .find(
        {},                
        { projection: { image: 1, _id: 0 } }
      )
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();

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

    // like count api
    // const token = req.headers.authorization.split(" ")[1]
    app.patch("/lessons/:id/like", verifyFBToken, async (req, res) => {
      const lessonId = req.params.id;
      const userId = req.user.uid;;
      // console.log(userId);
      const lesson = await lessonsCollection.findOne({
        _id: new ObjectId(lessonId),
      });

      if (!lesson) {
        return res.status(404).json({ message: "Lesson not found" });
      }

      const alreadyLiked = lesson.likedBy?.includes(userId);

      if (alreadyLiked) {
        await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          {
            $pull: { likedBy: userId },
            $inc: { likesCount: -1 },
          }
        );

        return res.json({ liked: false });
      } else {
        await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          {
            $addToSet: { likedBy: userId }, // prevents duplicate
            $inc: { likesCount: 1 },
          }
        );

        return res.json({ liked: true });
      }
    });

    // save count post
    app.post("/savedLessons/toggle", verifyFBToken, async (req, res) => {
      const { lessonId } = req.body;
      const userId =req.user.uid;;
      console.log(lessonId);

      const existing = await saveCollection.findOne({ lessonId, userId });
      const savedCount = await saveCollection.countDocuments({ lessonId });

      if (existing) {
        //  Unsave
        await saveCollection.deleteOne({ _id: existing._id });
        return res.json({ saved: false });
      } else {
        await saveCollection.insertOne({
          lessonId,
          userId,
          createdAt: new Date(),
        });
        return res.json({ saved: true }, { savedCount });
      }
    });
    //  *********************************
    // get saved lesson
    app.get("/savedLessons/users", verifyFBToken, async (req, res) => {
      const userId = req.user.uid;

      const savedLessons = await saveCollection
        .find({ userId })
        .sort({ savedAt: -1 })
        .toArray();

      res.json(savedLessons);
    });

  
    /* ===================== Delete Saved Lesson ===================== */
    app.delete("/savedLessons/:id", verifyFBToken, async (req, res) => {
      const savedId = req.params.id;

      try {
        const result = await saveCollection.deleteOne({
          _id: new ObjectId(savedId),
        });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Saved lesson not found" });
        }
        res.json({ message: "Removed from saved lessons" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to remove saved lesson" });
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

    app.post("/lessons",verifyFBToken, async (req, res) => {
      try {
        const lesson = req.body;
        const userId = req.user.uid
console.log(userId);
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
        lesson.likeCount = 0;
        lesson.creatorId = userId;

        const result = await lessonsCollection.insertOne(lesson);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });


    // GET /dashboard
app.get("/dashboard", verifyFBToken, async (req, res) => {
  const userId = req.user.uid; // get UID from Firebase decoded token

  try {
    // 1️⃣ Total lessons created
    const totalLessons = await lessonsCollection.countDocuments({ creatorId: userId });

    // 2️⃣ Total saved lessons
    const totalSaved = await saveCollection.countDocuments({ userId });

    // 3️⃣ Recently added lessons (last 5)
    const recentLessons = await lessonsCollection
      .find({ creatorId: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // 4️⃣ Weekly contributions (lessons created per day)
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - 6); // last 7 days
    startOfWeek.setHours(0, 0, 0, 0);

    const weeklyData = await lessonsCollection
      .aggregate([
        {
          $match: {
            creatorId: userId,
            createdAt: { $gte: startOfWeek },
          },
        },
        {
          $project: {
            day: { $dayOfWeek: "$createdAt" }, // Sunday=1, Saturday=7
          },
        },
        {
          $group: {
            _id: "$day",
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    // Format days
    const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyContributions = Array(7)
      .fill(0)
      .map((_, i) => {
        const dayData = weeklyData.find((d) => d._id === i + 1);
        return { day: dayMap[i], count: dayData ? dayData.count : 0 };
      });

    res.json({
      totalLessons,
      totalSaved,
      recentLessons,
      weeklyContributions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// admin dashboardHome related api
// GET /admin/stats
app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await userCollection.estimatedDocumentCount();

    const publicLessons = await lessonsCollection.countDocuments({
      privacy: "Public",
    });
    const privetLessons = await lessonsCollection.countDocuments({
      privacy: "Private",
    });

    const reportedLessons = await lessonsCollection.countDocuments({
      isReported: true,
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayLessons = await lessonsCollection.countDocuments({
      createdAt: { $gte: today },
    });

    res.send({
      totalUsers,
      publicLessons,
      reportedLessons,
      todayLessons,
      privetLessons
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// GET /admin/growth/users
app.get("/admin/growth/users", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const result = await userCollection.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          count: 1,
        },
      },
    ]).toArray();

    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});


// PATCH /lessons/review/:id
// app.patch("/lessons/review/:id",verifyFBToken,verifyAdmin, async (req, res) => {
//   const lessonId = req.params.id;
// console.log(lessonId);
//   try {
//     const result = await lessonReportsCollection.updateOne(
//       { _id: new ObjectId(lessonId) },
//       { $set: { status: "approved" } } 
//     );
//     console.log(result);

//     if (result.modifiedCount === 1) {
//       res.status(200).json({ message: "Lesson approved", modifiedCount: 1 });
//     } else {
//       res.status(404).json({ message: "Lesson not found", modifiedCount: 0 });
//     }
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });


// GET /admin/top-contributors
app.get("/admin/top-contributors", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const result = await lessonsCollection.aggregate([
      {
        $group: {
          _id: "$email",
          lessonCount: { $sum: 1 },
        },
      },
      { $sort: { lessonCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "email",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          email: "$_id",
          name: "$user.name",
          lessonCount: 1,
        },
      },
    ]).toArray();

    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});




    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
