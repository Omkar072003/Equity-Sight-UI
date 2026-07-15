import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  TwitterAuthProvider 
} from "firebase/auth";

// Replace these placeholders with your unique project keys from the Firebase Console dashboard
const firebaseConfig = {
  apiKey: "AIzaSyAEzSuEHL5h7zpKSxOCTgJ72Kj8c2hoIDM",
  authDomain: "equity-sight-53da2.firebaseapp.com",
  projectId: "equity-sight-53da2",
  storageBucket: "equity-sight-53da2.firebasestorage.app",
  messagingSenderId: "680238924654",
  appId: "1:680238924654:web:95199989724949b1f1377f",
  measurementId: "G-SRQC3W9HFQ"
};

// Singleton initialization to prevent hot-reloading duplication crashes
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();
export const twitterProvider = new TwitterAuthProvider();