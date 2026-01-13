// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAUdYIckSCuw7efsiiIdo7scMYBvArDM1U",
  authDomain: "f1historyviewer.firebaseapp.com",
  projectId: "f1historyviewer",
  storageBucket: "f1historyviewer.firebasestorage.app",
  messagingSenderId: "55463975664",
  appId: "1:55463975664:web:a900a3e8188f05868bc035"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);