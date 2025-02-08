const express = require("express");
const passport = require("passport");
const session = require("express-session");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
require("dotenv").config();

const app = express();

// Configure session
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
    },
    (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

// Serialize user into session
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user, done) => {
  done(null, user);
});
const cors = require('cors');

const allowedOrigins = [
    'https://pbangiola.github.io', // Allow frontend
];

app.use(cors({
    origin: allowedOrigins,
    credentials: true // Allow cookies/sessions if using them
}));

// Google OAuth Routes
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);

// Logout Route
app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

// Protected Route Example
app.get("/dashboard", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/");
  }
  res.send(`Welcome, ${req.user.displayName}`);
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
