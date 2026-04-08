const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const db = require("./database");

// ==========================
// VIIVAKOODI
// ==========================
function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatAmountForBarcode(amount) {
  const cents = Math.round(Number(amount || 0) * 100);
  return String(cents).padStart(8, "0");
}

function formatReferenceForBarcode(reference) {
  return onlyDigits(reference).padStart(20, "0");
}

function formatDueDateForBarcode(dateStr) {
  if (!dateStr) return "000000";

  const parts = dateStr.split("-");
  if (parts.length !== 3) return "000000";

  const year = parts[0].slice(-2);
  const month = parts[1];
  const day = parts[2];

  return `${year}${month}${day}`;
}

function createFinnishBarcodeString({ iban, amount, referenceNumber, dueDate }) {
  const ibanDigits = onlyDigits(iban);
  const amountPart = formatAmountForBarcode(amount);
  const referencePart = formatReferenceForBarcode(referenceNumber);
  const dueDatePart = formatDueDateForBarcode(dueDate);

  // Ensimmäinen numero kertoo version.
  // Tässä käytetään versiota 5.
  return `5${ibanDigits}${amountPart}000${referencePart}${dueDatePart}`;
}

// ===================
// ALOITUS IKKUNA
// ===================
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

ipcMain.handle("update-customer", async (event, customer) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE customers
      SET name = ?,
          businessId = ?,
          address = ?,
          postalCode = ?,
          city = ?,
          email = ?,
          phone = ?
      WHERE id = ?
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
        customer.phone,
        customer.id
      ],
      function (err) {
        if (err) {
          reject(err.message);
        } else {
          resolve({ message: "Asiakas päivitetty onnistuneesti" });
        }
      }
    );
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

          if (settings.logoPath) {
            try {
              doc.image(settings.logoPath, 50, 45, {
                fit: [80, 40],
                align: "left"
              });
            } catch (logoError) {
              console.log("Logon lataus epäonnistui:", logoError.message);
            }
          }

          // Värit
          const primaryColor = "#0d5f8f";
          const darkColor = "#1f2937";
          const lightGray = "#e5e7eb";

          // Summat
          const subtotal = rows.reduce((sum, row) => {
            const rowSubtotal = Number(row.quantity || 0) * Number(row.price || 0);
            return sum + rowSubtotal;
          }, 0);

          const vatTotal = rows.reduce((sum, row) => {
            const rowSubtotal = Number(row.quantity || 0) * Number(row.price || 0);
            const rowVat = rowSubtotal * (Number(row.vat || 0) / 100);
            return sum + rowVat;
          }, 0);

          const grandTotal = subtotal + vatTotal;

          // Otsikko
          doc
            .fontSize(26)
            .fillColor(primaryColor)
            .text("LASKU", 430, 50, { align: "right" });

          doc
            .moveTo(50, 90)
            .lineTo(560, 90)
            .strokeColor(lightGray)
            .stroke();

          // Lähettäjän tiedot
          doc
            .fillColor(darkColor)
            .fontSize(12)
            .text(settings.companyName || "-", 50, 110)
            .fontSize(10)
            .text(settings.address || "-", 50, 128)
            .text(`${settings.postalCode || ""} ${settings.city || ""}`, 50, 144)
            .text(`Y-tunnus: ${settings.businessId || "-"}`, 50, 160)
            .text(`Sähköposti: ${settings.email || "-"}`, 50, 176)
            .text(`Puhelin: ${settings.phone || "-"}`, 50, 192);

          if (settings.website) {
            doc.text(`Verkkosivu: ${settings.website}`, 50, 208);
          }

          // Laskun tiedot oikealle
          doc
            .fontSize(11)
            .fillColor(darkColor)
            .text("Laskun tiedot", 360, 110, { underline: true })
            .text(`Laskunumero: ${invoice.invoiceNumber}`, 360, 132)
            .text(`Päiväys: ${invoice.date}`, 360, 148)
            .text(`Eräpäivä: ${invoice.dueDate}`, 360, 164)
            .text(`Viitenumero: ${invoice.referenceNumber || "-"}`, 360, 180)
            .text(`Tila: ${invoice.status || "Luotu"}`, 360, 196);

          // Asiakkaan tiedot laatikossa
          doc
            .roundedRect(50, 245, 510, 95, 8)
            .strokeColor(lightGray)
            .stroke();

          doc
            .fillColor(primaryColor)
            .fontSize(12)
            .text("Laskutetaan", 65, 258);

          doc
            .fillColor(darkColor)
            .fontSize(11)
            .text(invoice.customerName || "-", 65, 280)
            .text(invoice.address || "-", 65, 297)
            .text(`${invoice.postalCode || ""} ${invoice.city || ""}`, 65, 314);

          if (invoice.businessId) {
            doc.text(`Y-tunnus: ${invoice.businessId}`, 280, 280);
          }
          if (invoice.email) {
            doc.text(`Sähköposti: ${invoice.email}`, 280, 297);
          }
          if (invoice.phone) {
            doc.text(`Puhelin: ${invoice.phone}`, 280, 314);
          }

          // Laskurivit otsikko
          let y = 370;

          doc
            .fillColor(primaryColor)
            .fontSize(12)
            .text("Laskurivit", 50, y);

          y += 22;

          // Taulukon otsikkorivi
          doc
            .rect(50, y, 510, 24)
            .fillAndStroke(primaryColor, primaryColor);

          doc
            .fillColor("white")
            .fontSize(10)
            .text("Kuvaus", 58, y + 7, { width: 170 })
            .text("Määrä", 250, y + 7, { width: 40, align: "right" })
            .text("Yks.", 300, y + 7, { width: 40, align: "right" })
            .text("Hinta", 360, y + 7, { width: 60, align: "right" })
            .text("ALV %", 430, y + 7, { width: 45, align: "right" })
            .text("Yhteensä", 485, y + 7, { width: 65, align: "right" });

          y += 30;

          // Laskurivit
          rows.forEach((row, index) => {
            const rowHeight = 24;

            if (index % 2 === 0) {
              doc
                .rect(50, y - 3, 510, rowHeight)
                .fill("#f9fafb");
            }

            doc
              .fillColor(darkColor)
              .fontSize(10)
              .text(row.description || "-", 58, y + 2, { width: 170 })
              .text(String(row.quantity ?? 0), 250, y + 2, { width: 40, align: "right" })
              .text(row.unit || "-", 300, y + 2, { width: 40, align: "right" })
              .text(`${Number(row.price || 0).toFixed(2)} €`, 360, y + 2, { width: 60, align: "right" })
              .text(`${Number(row.vat || 0).toFixed(1)}`, 430, y + 2, { width: 45, align: "right" })
              .text(`${Number(row.rowTotal || 0).toFixed(2)} €`, 485, y + 2, { width: 65, align: "right" });

            y += rowHeight;

            if (y > 690) {
              doc.addPage();
              y = 60;
            }
          });

          // Summalaatikko
          y += 15;

          doc
            .roundedRect(320, y, 240, 90, 8)
            .fillAndStroke("#eef6fb", "#d1e3f0");

          doc
            .fillColor(darkColor)
            .fontSize(11)
            .text("Veroton summa", 335, y + 12)
            .text(`${subtotal.toFixed(2)} €`, 470, y + 12, { width: 70, align: "right" });

          doc
            .text("ALV", 335, y + 34)
            .text(`${vatTotal.toFixed(2)} €`, 470, y + 34, { width: 70, align: "right" });

          doc
            .fontSize(13)
            .fillColor(primaryColor)
            .text("Yhteensä", 335, y + 60)
            .text(`${grandTotal.toFixed(2)} €`, 460, y + 60, { width: 80, align: "right" });

          // Maksutiedot laatikossa
          y += 110;

          doc
            .roundedRect(50, y, 510, 105, 8)
            .strokeColor(lightGray)
            .stroke();

          doc
            .fillColor(primaryColor)
            .fontSize(12)
            .text("Maksutiedot", 65, y + 15);

          doc
            .fillColor(darkColor)
            .fontSize(10)
            .text(`Saaja: ${settings.companyName || "-"}`, 65, y + 40)
            .text(`IBAN: ${settings.iban || "-"}`, 65, y + 58)
            .text(`BIC: ${settings.bic || "-"}`, 65, y + 76)
            .text(`Viitenumero: ${invoice.referenceNumber || "-"}`, 300, y + 40)
            .text(`Eräpäivä: ${invoice.dueDate}`, 300, y + 58)
            .text(`Summa: ${grandTotal.toFixed(2)} €`, 300, y + 76);

          // Viivakoodi
          try {
            const barcodeString = createFinnishBarcodeString({
              iban: settings.iban,
              amount: grandTotal,
              referenceNumber: invoice.referenceNumber,
              dueDate: invoice.dueDate
            });

            const pngBuffer = await bwipjs.toBuffer({
              bcid: "interleaved2of5",
              text: barcodeString,
              scale: 2,
              height: 12,
              includetext: false
            });

            doc
              .fillColor(primaryColor)
              .fontSize(12)
              .text("Pankkiviivakoodi", 50, y + 145);

            doc.image(pngBuffer, 50, y + 165, {
              width: 400,
              height: 30
            });
          } catch (barcodeError) {
            doc
              .fillColor("red")
              .fontSize(10)
              .text("Viivakoodin luonti epäonnistui.", 50, y + 145);
          }

          // Alateksti
          doc
            .fillColor(darkColor)
            .fontSize(10)
            .text("Kiitos yhteistyöstä!", 50, y + 250);

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

ipcMain.handle("get-next-invoice-number", async () => {
  return new Promise((resolve, reject) => {
    const currentYear = new Date().getFullYear();
    const prefix = `${currentYear}-`;

    const sql = `
      SELECT invoiceNumber
      FROM invoices
      WHERE invoiceNumber LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `;

    db.get(sql, [`${prefix}%`], (err, row) => {
      if (err) {
        reject(err.message);
        return;
      }

      if (!row || !row.invoiceNumber) {
        resolve(`${currentYear}-001`);
        return;
      }

      const parts = row.invoiceNumber.split("-");
      const runningNumber = parseInt(parts[1], 10) || 0;
      const nextNumber = String(runningNumber + 1).padStart(3, "0");

      resolve(`${currentYear}-${nextNumber}`);
    });
  });
});

ipcMain.handle("update-invoice-status", async (event, invoiceId, newStatus) => {
  return new Promise((resolve, reject) => {
    const allowedStatuses = ["Luotu", "Lähetetty", "Maksettu"];

    if (!allowedStatuses.includes(newStatus)) {
      reject("Virheellinen laskun tila.");
      return;
    }

    const sql = `
      UPDATE invoices
      SET status = ?
      WHERE id = ?
    `;

    db.run(sql, [newStatus, invoiceId], function (err) {
      if (err) {
        reject(err.message);
      } else {
        resolve({ message: "Laskun tila päivitetty onnistuneesti" });
      }
    });
  });
});

// =========================
// Sähköpostin avaaminen
// =========================
ipcMain.handle("prepare-invoice-email", async (event, invoiceId) => {
  return new Promise((resolve, reject) => {
    const invoiceSql = `
      SELECT invoices.*, customers.name AS customerName, customers.email AS customerEmail
      FROM invoices
      LEFT JOIN customers ON invoices.customerId = customers.id
      WHERE invoices.id = ?
    `;

    db.get(invoiceSql, [invoiceId], async (err, invoice) => {
      if (err) {
        reject(err.message);
        return;
      }

      if (!invoice) {
        reject("Laskua ei löytynyt.");
        return;
      }

      if (!invoice.customerEmail) {
        reject("Asiakkaalla ei ole sähköpostiosoitetta.");
        return;
      }

      const subject = `Lasku ${invoice.invoiceNumber}`;
      const body =
        `Hei,%0D%0A%0D%0A` +
        `Liitteenä lasku ${invoice.invoiceNumber}.%0D%0A%0D%0A` +
        `Ystävällisin terveisin`;

      const mailtoLink =
        `mailto:${encodeURIComponent(invoice.customerEmail)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${body}`;

      try {
        await shell.openExternal(mailtoLink);
        resolve({
          message: `Sähköpostiluonnos avattu asiakkaalle ${invoice.customerEmail}`
        });
      } catch (openError) {
        reject("Sähköpostiluonnoksen avaaminen epäonnistui: " + openError.message);
      }
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
          bic = ?,
          logoPath = ?
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
        settings.bic,
        settings.logoPath
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

ipcMain.handle("select-logo", async () => {
  const result = await dialog.showOpenDialog({
    title: "Valitse yrityksen logo",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return result.filePaths[0];
});