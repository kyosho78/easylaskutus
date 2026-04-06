const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "laskutus.db");
const db = new sqlite3.Database(dbPath);

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
      bic TEXT
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (
      id, companyName, businessId, address, postalCode, city, email, phone, website, iban, bic
    )
    VALUES (1, '', '', '', '', '', '', '', '', '', '')
  `);
});

module.exports = db;