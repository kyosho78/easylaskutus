const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const baseDir = app.isPackaged
  ? path.join(app.getPath("userData"), "data")
  : __dirname;

if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

const dbPath = path.join(baseDir, "laskutus.db");

console.log("DB PATH:", dbPath);
console.log("APP IS PACKAGED:", app.isPackaged);

const db = new sqlite3.Database(dbPath);

db.filename = dbPath;

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      businessId TEXT,
      address TEXT,
      postalCode TEXT,
      city TEXT,
      email TEXT,
      phone TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId INTEGER,
      invoiceNumber TEXT,
      date TEXT,
      dueDate TEXT,
      referenceNumber TEXT,
      total REAL,
      status TEXT,
      FOREIGN KEY(customerId) REFERENCES customers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceId INTEGER,
      description TEXT,
      quantity REAL,
      unit TEXT,
      price REAL,
      vat REAL,
      rowTotal REAL,
      FOREIGN KEY(invoiceId) REFERENCES invoices(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      companyName TEXT,
      businessId TEXT,
      address TEXT,
      postalCode TEXT,
      city TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      iban TEXT,
      bic TEXT,
      logoPath TEXT,
      donationReminderDisabled INTEGER DEFAULT 0
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (
      id, companyName, businessId, address, postalCode, city, email, phone, website, iban, bic, logoPath, donationReminderDisabled
    )
    VALUES (1, '', '', '', '', '', '', '', '', '', '', '', 0)
  `);

  // Migration for older databases:
  // if the column already exists, SQLite throws an error, which we ignore
  db.run(
    `ALTER TABLE settings ADD COLUMN donationReminderDisabled INTEGER DEFAULT 0`,
    (err) => {
      if (err) {
        if (err.message.includes("duplicate column name")) {
          console.log("Column donationReminderDisabled already exists.");
        } else {
          console.error("Failed to add donationReminderDisabled column:", err.message);
        }
      } else {
        console.log("Column donationReminderDisabled added successfully.");
      }
    }
  );
});

module.exports = db;