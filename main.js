const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const path = require("path");
let db;

// ==========================
// Trial / support popup logic
// ==========================
function getTrialFilePath() {
  return path.join(app.getPath("userData"), "trial.json");
}

function getOrCreateTrialData() {
  const trialPath = getTrialFilePath();

  if (!fs.existsSync(trialPath)) {
    const data = {
      firstRunDate: new Date().toISOString(),
      firstPopupShown: false,
      sixMonthPopupShown: false,
      lastReminderDate: null
    };

    fs.writeFileSync(trialPath, JSON.stringify(data, null, 2), "utf8");
    return data;
  }

  try {
    const raw = fs.readFileSync(trialPath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      firstRunDate: parsed.firstRunDate || new Date().toISOString(),
      firstPopupShown: parsed.firstPopupShown || false,
      sixMonthPopupShown: parsed.sixMonthPopupShown || false,
      lastReminderDate: parsed.lastReminderDate || null
    };
  } catch (error) {
    const fallbackData = {
      firstRunDate: new Date().toISOString(),
      firstPopupShown: false,
      sixMonthPopupShown: false,
      lastReminderDate: null
    };

    fs.writeFileSync(trialPath, JSON.stringify(fallbackData, null, 2), "utf8");
    return fallbackData;
  }
}

function saveTrialData(data) {
  const trialPath = getTrialFilePath();
  fs.writeFileSync(trialPath, JSON.stringify(data, null, 2), "utf8");
}

function isDonationReminderDisabled() {
  return new Promise((resolve) => {
    db.get(
      "SELECT donationReminderDisabled FROM settings WHERE id = 1",
      [],
      (err, row) => {
        if (err) {
          console.error("Failed to read donationReminderDisabled:", err.message);
          resolve(false);
          return;
        }

        resolve(Boolean(row?.donationReminderDisabled));
      }
    );
  });
}

async function shouldShowDonationPopup() {
  const remindersDisabled = await isDonationReminderDisabled();

  if (remindersDisabled) {
    return false;
  }

  const data = getOrCreateTrialData();
  const now = new Date();
  const firstRun = new Date(data.firstRunDate);

  const diffDays = (now - firstRun) / (1000 * 60 * 60 * 24);

  // 1) Show popup on first ever run
  if (!data.firstPopupShown) {
    data.firstPopupShown = true;
    saveTrialData(data);
    return true;
  }

  // 2) Before 6 months, do not show popup
  if (diffDays < 180) {
    return false;
  }

  // 3) Show once when 6 months has passed
  if (!data.sixMonthPopupShown) {
    data.sixMonthPopupShown = true;
    data.lastReminderDate = now.toISOString();
    saveTrialData(data);
    return true;
  }

  // 4) After 6 months, show every 30 days
  if (!data.lastReminderDate) {
    data.lastReminderDate = now.toISOString();
    saveTrialData(data);
    return true;
  }

  const lastReminder = new Date(data.lastReminderDate);
  const daysSinceReminder = (now - lastReminder) / (1000 * 60 * 60 * 24);

  if (daysSinceReminder >= 30) {
    data.lastReminderDate = now.toISOString();
    saveTrialData(data);
    return true;
  }

  return false;
}

async function showDonationPopup(parentWindow) {
  const result = await dialog.showMessageBox(parentWindow, {
    type: "info",
    buttons: ["Buy / Support", "Continue using app"],
    defaultId: 1,
    cancelId: 1,
    title: "Support EasyLaskutus",
    message: "Support EasyLaskutus",
    detail:
      "If the app has been useful, please consider supporting development."
  });

  if (result.response === 0) {
    await shell.openExternal("https://buymeacoffee.com/easylaskutus");
  }
}

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
  return win;
}

app.whenReady().then(async () => {
  db = require("./database");
  const win = createWindow();

  if (shouldShowDonationPopup()) {
    await showDonationPopup(win);
  }

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

ipcMain.handle("delete-customer", async (event, customerId) => {
  return new Promise((resolve, reject) => {
    // First check if customer has invoices
    db.get(
      "SELECT COUNT(*) AS count FROM invoices WHERE customerId = ?",
      [customerId],
      (checkErr, row) => {
        if (checkErr) {
          reject(checkErr.message);
          return;
        }

        if (row.count > 0) {
          reject("Asiakasta ei voi poistaa, koska siihen liittyy laskuja.");
          return;
        }

        db.run("DELETE FROM customers WHERE id = ?", [customerId], function (err) {
          if (err) {
            reject(err.message);
          } else {
            resolve({ message: "Asiakas poistettu onnistuneesti" });
          }
        });
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

ipcMain.handle("delete-invoice", async (event, invoiceId) => {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM invoice_rows WHERE invoiceId = ?", [invoiceId], function (rowErr) {
      if (rowErr) {
        reject(rowErr.message);
        return;
      }

      db.run("DELETE FROM invoices WHERE id = ?", [invoiceId], function (invoiceErr) {
        if (invoiceErr) {
          reject(invoiceErr.message);
        } else {
          resolve({ message: "Lasku poistettu onnistuneesti" });
        }
      });
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
          logoPath = ?,
          donationReminderDisabled = ?
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
        settings.logoPath,
        settings.donationReminderDisabled ? 1 : 0
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

ipcMain.handle("activate-donor-code", async (event, code) => {
  return new Promise((resolve, reject) => {
    const validCodes = ["EASYTHANKS2026"]; // change this to your own code

    if (!validCodes.includes(String(code).trim())) {
      reject("Virheellinen tukikoodi.");
      return;
    }

    db.run(
      "UPDATE settings SET donationReminderDisabled = 1 WHERE id = 1",
      [],
      function (err) {
        if (err) {
          reject(err.message);
        } else {
          resolve({ message: "Kiitos tuesta! Muistutusponnahdusikkuna on poistettu käytöstä." });
        }
      }
    );
  });
});

ipcMain.handle("disable-donor-code", async () => {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE settings SET donationReminderDisabled = 0 WHERE id = 1",
      [],
      function (err) {
        if (err) {
          reject(err.message);
        } else {
          resolve({ message: "Tukimuistutukset on otettu takaisin käyttöön." });
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

ipcMain.handle("export-database", async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const sourceDbPath = db.filename;

      if (!sourceDbPath) {
        reject("Tietokannan polkua ei löytynyt.");
        return;
      }

      const result = await dialog.showSaveDialog({
        title: "Vie tietokanta",
        defaultPath: "laskutus-backup.db",
        filters: [{ name: "Database", extensions: ["db"] }]
      });

      if (result.canceled || !result.filePath) {
        reject("Vienti peruutettiin.");
        return;
      }

      fs.copyFile(sourceDbPath, result.filePath, (err) => {
        if (err) {
          reject("Tietokannan vienti epäonnistui: " + err.message);
        } else {
          resolve({ message: `Tietokanta vietiin: ${result.filePath}` });
        }
      });
    } catch (error) {
      reject("Tietokannan vienti epäonnistui: " + error.message);
    }
  });
});

ipcMain.handle("import-database", async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Tuo tietokanta",
        properties: ["openFile"],
        filters: [{ name: "Database", extensions: ["db"] }]
      });

      if (result.canceled || !result.filePaths.length) {
        reject("Tuonti peruutettiin.");
        return;
      }

      const selectedFile = result.filePaths[0];
      const targetDbPath = db.filename;

      if (!targetDbPath) {
        reject("Tietokannan polkua ei löytynyt.");
        return;
      }

      db.close((closeErr) => {
        if (closeErr) {
          reject("Tietokannan sulkeminen epäonnistui: " + closeErr.message);
          return;
        }

        fs.copyFile(selectedFile, targetDbPath, (copyErr) => {
          if (copyErr) {
            reject("Tietokannan tuonti epäonnistui: " + copyErr.message);
            return;
          }

          resolve({
            message: "Tietokanta tuotu onnistuneesti. Ohjelma suljetaan, jotta muutokset tulevat voimaan."
          });
        });
      });
    } catch (error) {
      reject("Tietokannan tuonti epäonnistui: " + error.message);
    }
  });
});

ipcMain.handle("export-customers-csv", async () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM customers ORDER BY name ASC", [], async (err, rows) => {
      if (err) {
        reject("Asiakkaiden haku epäonnistui: " + err.message);
        return;
      }

      try {
        const result = await dialog.showSaveDialog({
          title: "Vie asiakkaat CSV-tiedostoon",
          defaultPath: "asiakkaat.csv",
          filters: [{ name: "CSV", extensions: ["csv"] }]
        });

        if (result.canceled || !result.filePath) {
          reject("Vienti peruutettiin.");
          return;
        }

        const header = [
          "id",
          "name",
          "businessId",
          "address",
          "postalCode",
          "city",
          "email",
          "phone"
        ];

        const escapeCsvValue = (value) => {
          const str = String(value ?? "");
          return `"${str.replace(/"/g, '""')}"`;
        };

        const csvLines = [
          header.join(";"),
          ...rows.map((row) =>
            [
              row.id,
              row.name,
              row.businessId,
              row.address,
              row.postalCode,
              row.city,
              row.email,
              row.phone
            ]
              .map(escapeCsvValue)
              .join(";")
          )
        ];

        fs.writeFile(result.filePath, csvLines.join("\n"), "utf8", (writeErr) => {
          if (writeErr) {
            reject("CSV-vienti epäonnistui: " + writeErr.message);
          } else {
            resolve({ message: `Asiakkaat vietiin: ${result.filePath}` });
          }
        });
      } catch (error) {
        reject("CSV-vienti epäonnistui: " + error.message);
      }
    });
  });
});

ipcMain.handle("export-invoices-csv", async () => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT
        invoices.id,
        invoices.invoiceNumber,
        invoices.date,
        invoices.dueDate,
        invoices.referenceNumber,
        invoices.total,
        invoices.status,
        customers.name AS customerName,
        customers.businessId,
        customers.email,
        customers.phone
      FROM invoices
      LEFT JOIN customers ON invoices.customerId = customers.id
      ORDER BY invoices.id DESC
    `;

    db.all(sql, [], async (err, rows) => {
      if (err) {
        reject("Laskujen haku epäonnistui: " + err.message);
        return;
      }

      try {
        const result = await dialog.showSaveDialog({
          title: "Vie laskut CSV-tiedostoon",
          defaultPath: "laskut.csv",
          filters: [{ name: "CSV Files", extensions: ["csv"] }]
        });

        if (result.canceled || !result.filePath) {
          reject("CSV-vienti peruutettiin.");
          return;
        }

        const header = [
          "ID",
          "Laskunumero",
          "Päiväys",
          "Eräpäivä",
          "Viitenumero",
          "Summa",
          "Tila",
          "Asiakas",
          "Y-tunnus",
          "Sähköposti",
          "Puhelin"
        ];

        const csvRows = rows.map((row) => [
          row.id,
          row.invoiceNumber || "",
          row.date || "",
          row.dueDate || "",
          row.referenceNumber || "",
          row.total ?? "",
          row.status || "",
          row.customerName || "",
          row.businessId || "",
          row.email || "",
          row.phone || ""
        ]);

        const escapeCsvValue = (value) => {
          const stringValue = String(value ?? "");
          return `"${stringValue.replace(/"/g, '""')}"`;
        };

        const csvContent = [
          header.map(escapeCsvValue).join(";"),
          ...csvRows.map((row) => row.map(escapeCsvValue).join(";"))
        ].join("\n");

        fs.writeFile(result.filePath, "\uFEFF" + csvContent, "utf8", (writeErr) => {
          if (writeErr) {
            reject("CSV-tiedoston tallennus epäonnistui: " + writeErr.message);
            return;
          }

          resolve({
            message: `Laskut vietiin onnistuneesti: ${result.filePath}`
          });
        });
      } catch (error) {
        reject("CSV-vienti epäonnistui: " + error.message);
      }
    });
  });
});

// =========================
// OTA YHTEYTTÄ KEHITTIJÄÄN
// =========================
ipcMain.handle("contact-support", async () => {
  const subject = "EasyLaskutus support";
  const body =
    "Hi,%0D%0A%0D%0AI need help with EasyLaskutus.%0D%0A%0D%0APlease describe the issue here.%0D%0A";

  const mailtoLink =
    `mailto:walter@wbservice.fi?subject=${encodeURIComponent(subject)}&body=${body}`;

  try {
    await shell.openExternal(mailtoLink);
    return { message: "Support email opened." };
  } catch (error) {
    throw new Error("Support email could not be opened: " + error.message);
  }
});

ipcMain.handle("restart-app", async () => {
  app.relaunch();
  app.exit(0);
});