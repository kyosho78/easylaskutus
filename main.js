const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const db = require("./database");

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// =========================
// ASIAKKAAT
// =========================
ipcMain.handle("add-customer", async (event, customer) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO customers (name, businessId, address, postalCode, city, email, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      sql,
      [
        customer.name,
        customer.businessId,
        customer.address,
        customer.postalCode,
        customer.city,
        customer.email,
        customer.phone
      ],
      function (err) {
        if (err) {
          reject(err.message);
        } else {
          resolve({ id: this.lastID, message: "Asiakas lisätty onnistuneesti" });
        }
      }
    );
  });
});

ipcMain.handle("get-customers", async () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM customers ORDER BY name ASC", [], (err, rows) => {
      if (err) {
        reject(err.message);
      } else {
        resolve(rows);
      }
    });
  });
});

// =========================
// LASKUT
// =========================
ipcMain.handle("save-invoice", async (event, invoiceData) => {
  return new Promise((resolve, reject) => {
    const invoiceSql = `
      INSERT INTO invoices (customerId, invoiceNumber, date, dueDate, referenceNumber, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      invoiceSql,
      [
        invoiceData.customerId,
        invoiceData.invoiceNumber,
        invoiceData.date,
        invoiceData.dueDate,
        invoiceData.referenceNumber,
        invoiceData.total,
        "Luotu"
      ],
      function (err) {
        if (err) {
          reject(err.message);
          return;
        }

        const invoiceId = this.lastID;
        const rows = invoiceData.rows;

        if (!rows || rows.length === 0) {
          resolve({ message: "Lasku tallennettu ilman rivejä" });
          return;
        }

        const rowSql = `
          INSERT INTO invoice_rows (invoiceId, description, quantity, unit, price, vat, rowTotal)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        let completed = 0;
        let failed = false;

        rows.forEach((row) => {
          db.run(
            rowSql,
            [
              invoiceId,
              row.description,
              row.quantity,
              row.unit,
              row.price,
              row.vat,
              row.rowTotal
            ],
            function (rowErr) {
              if (failed) return;

              if (rowErr) {
                failed = true;
                reject(rowErr.message);
                return;
              }

              completed++;

              if (completed === rows.length) {
                resolve({ message: "Lasku tallennettu onnistuneesti", invoiceId });
              }
            }
          );
        });
      }
    );
  });
});

ipcMain.handle("get-invoices", async () => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT invoices.*, customers.name AS customerName
      FROM invoices
      LEFT JOIN customers ON invoices.customerId = customers.id
      ORDER BY invoices.id DESC
    `;

    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err.message);
      } else {
        resolve(rows);
      }
    });
  });
});

ipcMain.handle("get-invoice-by-id", async (event, invoiceId) => {
  return new Promise((resolve, reject) => {
    const invoiceSql = `
      SELECT invoices.*, customers.name AS customerName, customers.businessId, customers.address,
             customers.postalCode, customers.city, customers.email, customers.phone
      FROM invoices
      LEFT JOIN customers ON invoices.customerId = customers.id
      WHERE invoices.id = ?
    `;

    db.get(invoiceSql, [invoiceId], (err, invoice) => {
      if (err) {
        reject(err.message);
        return;
      }

      if (!invoice) {
        reject("Laskua ei löytynyt.");
        return;
      }

      const rowsSql = `
        SELECT * FROM invoice_rows
        WHERE invoiceId = ?
        ORDER BY id ASC
      `;

      db.all(rowsSql, [invoiceId], (rowErr, rows) => {
        if (rowErr) {
          reject(rowErr.message);
        } else {
          resolve({
            invoice,
            rows
          });
        }
      });
    });
  });
});

ipcMain.handle("generate-invoice-pdf", async (event, invoiceId) => {
  return new Promise((resolve, reject) => {
    const invoiceSql = `
      SELECT invoices.*, customers.name AS customerName, customers.businessId, customers.address,
             customers.postalCode, customers.city, customers.email, customers.phone
      FROM invoices
      LEFT JOIN customers ON invoices.customerId = customers.id
      WHERE invoices.id = ?
    `;

    db.get(invoiceSql, [invoiceId], (err, invoice) => {
      if (err) {
        reject(err.message);
        return;
      }

      if (!invoice) {
        reject("Laskua ei löytynyt.");
        return;
      }

      db.get("SELECT * FROM settings WHERE id = 1", [], (settingsErr, settings) => {
        if (settingsErr) {
          reject(settingsErr.message);
          return;
        }

        const rowsSql = `
          SELECT * FROM invoice_rows
          WHERE invoiceId = ?
          ORDER BY id ASC
        `;

        db.all(rowsSql, [invoiceId], async (rowErr, rows) => {
          if (rowErr) {
            reject(rowErr.message);
            return;
          }

          const result = await dialog.showSaveDialog({
            title: "Tallenna lasku PDF",
            defaultPath: `lasku-${invoice.invoiceNumber}.pdf`,
            filters: [{ name: "PDF Files", extensions: ["pdf"] }]
          });

          if (result.canceled || !result.filePath) {
            reject("Tallennus peruutettiin.");
            return;
          }

          const doc = new PDFDocument({ margin: 50 });
          const stream = fs.createWriteStream(result.filePath);
          doc.pipe(stream);

          // Otsikko
          doc.fontSize(22).text("LASKU", 400, 50, { align: "right" });

          // Lähettäjä / oma yritys
          doc.fontSize(12).text("Lähettäjä", 50, 50, { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(11);
          doc.text(settings.companyName || "-");
          doc.text(settings.address || "-");
          doc.text(`${settings.postalCode || ""} ${settings.city || ""}`);
          doc.text(`Y-tunnus: ${settings.businessId || "-"}`);
          doc.text(`Sähköposti: ${settings.email || "-"}`);
          doc.text(`Puhelin: ${settings.phone || "-"}`);
          doc.text(`Verkkosivu: ${settings.website || "-"}`);

          // Asiakas
          doc.fontSize(12).text("Asiakas", 50, 180, { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(11);
          doc.text(invoice.customerName || "-", 50, 200);
          doc.text(invoice.address || "-");
          doc.text(`${invoice.postalCode || ""} ${invoice.city || ""}`);
          doc.text(`Y-tunnus: ${invoice.businessId || "-"}`);
          doc.text(`Sähköposti: ${invoice.email || "-"}`);
          doc.text(`Puhelin: ${invoice.phone || "-"}`);

          // Laskun tiedot oikealle
          doc.fontSize(12).text("Laskun tiedot", 350, 180, { underline: true });
          doc.fontSize(11);
          doc.text(`Laskunumero: ${invoice.invoiceNumber}`, 350, 200);
          doc.text(`Päiväys: ${invoice.date}`, 350, 220);
          doc.text(`Eräpäivä: ${invoice.dueDate}`, 350, 240);
          doc.text(`Viitenumero: ${invoice.referenceNumber || "-"}`, 350, 260);

          // Laskurivit
          let y = 330;
          doc.fontSize(12).text("Laskurivit", 50, y, { underline: true });

          y += 25;
          doc.fontSize(10);
          doc.text("Kuvaus", 50, y);
          doc.text("Määrä", 250, y);
          doc.text("Yks.", 300, y);
          doc.text("Hinta", 350, y);
          doc.text("ALV %", 420, y);
          doc.text("Yhteensä", 490, y);

          y += 15;
          doc.moveTo(50, y).lineTo(560, y).stroke();

          y += 10;

          rows.forEach((row) => {
            doc.text(row.description || "-", 50, y, { width: 180 });
            doc.text(String(row.quantity ?? 0), 250, y);
            doc.text(row.unit || "-", 300, y);
            doc.text(`${Number(row.price || 0).toFixed(2)} €`, 350, y);
            doc.text(`${Number(row.vat || 0).toFixed(1)}`, 420, y);
            doc.text(`${Number(row.rowTotal || 0).toFixed(2)} €`, 490, y);

            y += 25;

            if (y > 720) {
              doc.addPage();
              y = 50;
            }
          });

          y += 10;
          doc.moveTo(50, y).lineTo(560, y).stroke();

          y += 20;
          doc.fontSize(13).text(`Kokonaissumma: ${Number(invoice.total || 0).toFixed(2)} €`, 360, y);

          // Maksutiedot
          y += 50;
          doc.fontSize(12).text("Maksutiedot", 50, y, { underline: true });

          y += 20;
          doc.fontSize(11);
          doc.text(`Saaja: ${settings.companyName || "-"}`, 50, y);
          doc.text(`IBAN: ${settings.iban || "-"}`, 50, y + 20);
          doc.text(`BIC: ${settings.bic || "-"}`, 50, y + 40);
          doc.text(`Viitenumero: ${invoice.referenceNumber || "-"}`, 50, y + 60);
          doc.text(`Summa: ${Number(invoice.total || 0).toFixed(2)} €`, 50, y + 80);
          doc.text(`Eräpäivä: ${invoice.dueDate}`, 50, y + 100);
          doc.text("Kiitos yhteistyöstä!", 50, y + 150);

          doc.end();

          stream.on("finish", () => {
            resolve(`PDF tallennettu: ${result.filePath}`);
          });

          stream.on("error", (streamErr) => {
            reject(streamErr.message);
          });
        });
      });
    });
  });
});

ipcMain.handle("get-settings", async () => {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM settings WHERE id = 1", [], (err, row) => {
      if (err) {
        reject(err.message);
      } else {
        resolve(row);
      }
    });
  });
});

ipcMain.handle("save-settings", async (event, settings) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE settings
      SET companyName = ?,
          businessId = ?,
          address = ?,
          postalCode = ?,
          city = ?,
          email = ?,
          phone = ?,
          website = ?,
          iban = ?,
          bic = ?
      WHERE id = 1
    `;

    db.run(
      sql,
      [
        settings.companyName,
        settings.businessId,
        settings.address,
        settings.postalCode,
        settings.city,
        settings.email,
        settings.phone,
        settings.website,
        settings.iban,
        settings.bic
      ],
      function (err) {
        if (err) {
          reject(err.message);
        } else {
          resolve({ message: "Asetukset tallennettu onnistuneesti" });
        }
      }
    );
  });
});