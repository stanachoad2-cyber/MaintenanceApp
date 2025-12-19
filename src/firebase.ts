// src/firebase.ts (หรือ firebase.js)
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// import { getAnalytics } from "firebase/analytics"; // ถ้าใช้ analytics

const firebaseConfig = {
  apiKey: "AIzaSyBMOJIJhxmgXWGSvabQNo_dcGYFJmErdyU",
  authDomain: "daily-check-d2393.firebaseapp.com",
  projectId: "daily-check-d2393",
  storageBucket: "daily-check-d2393.firebasestorage.app",
  messagingSenderId: "588844381774",
  appId: "1:588844381774:web:1def747749f48f4dd1f51f",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// export const analytics = getAnalytics(app); // ถ้าใช้
