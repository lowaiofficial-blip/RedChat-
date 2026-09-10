import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
import { FIREBASE_CONFIG } from "./src/services/firebase.ts"; // Oops, TS file

