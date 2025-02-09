const express = require("express");
const passport = require("passport");
const session = require("express-session");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cors = require("cors");
require("dotenv").config();

const app = express();

// ✅ CORS Setup - Move this to the top!
const allowedOrigins = [
    'https://pbangiola.github.io', // Allow frontend
];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

// ✅ Session Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// ✅ Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// ✅ Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://nexttask-7rj8.onrender.com/auth/google/callback", // Ensure this matches Google Console
    },
    (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

// ✅ Serialize user into session
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user, done) => {
  done(null, user);
});

// ✅ Ensure `/auth/session` exists!
app.get("/auth/session", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});

// ✅ Google OAuth Routes
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("https://pbangiola.github.io/nexttask"); // Redirect back to frontend
  }
);

// ✅ Logout Fix
app.get("/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect("https://pbangiola.github.io");
  });
});

// ✅ Test Route to Confirm Server Works
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
