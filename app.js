// app.js
// Firebase CDN (module version) ব্যবহার করছি
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 👉 এখানে আপনার config বসাবেন
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Collections
const itemsCol     = collection(db, "items");
const movementsCol = collection(db, "movements");

// DOM elements
const itemForm      = document.getElementById("item-form");
const movementForm  = document.getElementById("movement-form");
const itemSelect    = document.getElementById("movement-item");
const stockTableBody = document.querySelector("#stock-table tbody");

let cachedItems = []; // item id ধরে রাখবো

// Items লোড
async function loadItems() {
  const snap = await getDocs(itemsCol);
  cachedItems = [];
  itemSelect.innerHTML = "";

  snap.forEach(doc => {
    const data = doc.data();
    const item = { id: doc.id, ...data };
    cachedItems.push(item);

    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.code} - ${item.name}`;
    itemSelect.appendChild(opt);
  });
}

// Stock হিসাব: items + movements থেকে ক্লায়েন্ট সাইডে
async function loadStock() {
  // সব movements আনব
  const moveSnap = await getDocs(movementsCol);

  // itemId ভিত্তিক ম্যাপ বানাবো
  const stockMap = {};
  cachedItems.forEach(it => {
    stockMap[it.id] = {
      code: it.code,
      name: it.name,
      unit: it.unit,
      total_in: 0,
      total_out: 0
    };
  });

  moveSnap.forEach(doc => {
    const m = doc.data();
    if (!stockMap[m.itemId]) return;

    const qty = Number(m.qty) || 0;
    if (m.type === "IN") stockMap[m.itemId].total_in  += qty;
    if (m.type === "OUT") stockMap[m.itemId].total_out += qty;
  });

  // টেবিলে দেখানো
  stockTableBody.innerHTML = "";
  Object.values(stockMap).forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.code}</td>
      <td>${r.name}</td>
      <td>${r.unit}</td>
      <td>${r.total_in}</td>
      <td>${r.total_out}</td>
      <td>${r.total_in - r.total_out}</td>
    `;
    stockTableBody.appendChild(tr);
  });
}

// নতুন Item Save
itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("item-code").value.trim();
  const name = document.getElementById("item-name").value.trim();
  const unit = document.getElementById("item-unit").value.trim();

  if (!code || !name || !unit) return;

  await addDoc(itemsCol, { code, name, unit });
  itemForm.reset();

  await loadItems();
  await loadStock();
});

// Movement Save
movementForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const itemId  = itemSelect.value;
  const type    = document.getElementById("movement-type").value;
  const qty     = Number(document.getElementById("movement-qty").value);
  const date    = document.getElementById("movement-date").value;
  const remarks = document.getElementById("movement-remarks").value.trim();

  if (!itemId || !qty || !date) return;

  await addDoc(movementsCol, {
    itemId,
    type,
    qty,
    date,
    remarks
  });

  movementForm.reset();
  await loadStock();
});

// পেজ লোড হলে ডাটা লোড
window.addEventListener("load", async () => {
  await loadItems();
  await loadStock();
});
