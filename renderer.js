const { ipcRenderer } = require("electron");

// =========================
// ELEMENTIT
// =========================
const customersSection = document.getElementById("customersSection");
const newInvoiceSection = document.getElementById("newInvoiceSection");
const invoicesSection = document.getElementById("invoicesSection");
const settingsSection = document.getElementById("settingsSection");

const showCustomersBtn = document.getElementById("showCustomers");
const showNewInvoiceBtn = document.getElementById("showNewInvoice");
const showInvoicesBtn = document.getElementById("showInvoices");
const showSettingsBtn = document.getElementById("showSettings");

const customerForm = document.getElementById("customerForm");
const customerList = document.getElementById("customerList");
const customerMessage = document.getElementById("customerMessage");
const customerIdInput = document.getElementById("customerId");
const saveCustomerBtn = document.getElementById("saveCustomerBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const invoiceForm = document.getElementById("invoiceForm");
const invoiceCustomer = document.getElementById("invoiceCustomer");
const invoiceRows = document.getElementById("invoiceRows");
const addRowBtn = document.getElementById("addRowBtn");
const invoiceSubtotal = document.getElementById("invoiceSubtotal");
const invoiceVatTotal = document.getElementById("invoiceVatTotal");
const invoiceTotal = document.getElementById("invoiceTotal");
const invoiceMessage = document.getElementById("invoiceMessage");
const invoiceList = document.getElementById("invoiceList");
const invoiceNumberInput = document.getElementById("invoiceNumber");
const referenceNumberInput = document.getElementById("referenceNumber");

const settingsForm = document.getElementById("settingsForm");
const settingsMessage = document.getElementById("settingsMessage");
const selectLogoBtn = document.getElementById("selectLogoBtn");
const settingsLogoPath = document.getElementById("settingsLogoPath");

// =========================
// NÄKYMIEN VAIHTO
// =========================
function showSection(sectionToShow) {
  customersSection.classList.add("hidden");
  newInvoiceSection.classList.add("hidden");
  invoicesSection.classList.add("hidden");
  settingsSection.classList.add("hidden");

  sectionToShow.classList.remove("hidden");
}

showCustomersBtn.addEventListener("click", async () => {
  showSection(customersSection);
  await loadCustomers();
});

showNewInvoiceBtn.addEventListener("click", async () => {
  showSection(newInvoiceSection);
  await loadCustomers();
  await setNextInvoiceNumber();
  setDefaultDates();
});

showInvoicesBtn.addEventListener("click", async () => {
  showSection(invoicesSection);
  await loadInvoices();
});

showSettingsBtn.addEventListener("click", async () => {
  showSection(settingsSection);
  await loadSettings();
});

// =========================
// LOGON VALINTA
// =========================
selectLogoBtn.addEventListener("click", async () => {
  try {
    const selectedPath = await ipcRenderer.invoke("select-logo");
    if (selectedPath) {
      settingsLogoPath.value = selectedPath;
    }
  } catch (error) {
    settingsMessage.textContent = "Virhe logon valinnassa: " + error;
  }
});

// =========================
// ASIAKASLOMAKKEEN RESET
// =========================
function resetCustomerForm() {
  customerForm.reset();

  if (customerIdInput) {
    customerIdInput.value = "";
  }

  if (saveCustomerBtn) {
    saveCustomerBtn.textContent = "Tallenna asiakas";
  }

  if (cancelEditBtn) {
    cancelEditBtn.classList.add("hidden");
  }
}

// =========================
// ASIAKKAAT
// =========================
async function loadCustomers() {
  try {
    const customers = await ipcRenderer.invoke("get-customers");

    if (customers.length === 0) {
      customerList.innerHTML = "<p>Ei asiakkaita vielä.</p>";
      invoiceCustomer.innerHTML = `<option value="">Valitse asiakas</option>`;
      return;
    }

    customerList.innerHTML = customers
      .map(
        (customer) => `
          <div class="customer-card">
            <h3>${customer.name}</h3>
            <p><strong>Y-tunnus:</strong> ${customer.businessId || "-"}</p>
            <p><strong>Osoite:</strong> ${customer.address || "-"}, ${customer.postalCode || ""} ${customer.city || ""}</p>
            <p><strong>Sähköposti:</strong> ${customer.email || "-"}</p>
            <p><strong>Puhelin:</strong> ${customer.phone || "-"}</p>
            <button class="edit-customer-btn" data-id="${customer.id}">Muokkaa</button>
          </div>
        `
      )
      .join("");

    invoiceCustomer.innerHTML = `
      <option value="">Valitse asiakas</option>
      ${customers
        .map((customer) => `<option value="${customer.id}">${customer.name}</option>`)
        .join("")}
    `;

    document.querySelectorAll(".edit-customer-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const customerId = parseInt(button.dataset.id);
        const customers = await ipcRenderer.invoke("get-customers");
        const customer = customers.find((c) => c.id === customerId);

        if (!customer) return;

        customerIdInput.value = customer.id;
        document.getElementById("name").value = customer.name || "";
        document.getElementById("businessId").value = customer.businessId || "";
        document.getElementById("address").value = customer.address || "";
        document.getElementById("postalCode").value = customer.postalCode || "";
        document.getElementById("city").value = customer.city || "";
        document.getElementById("email").value = customer.email || "";
        document.getElementById("phone").value = customer.phone || "";

        saveCustomerBtn.textContent = "Päivitä asiakas";
        cancelEditBtn.classList.remove("hidden");

        showSection(customersSection);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  } catch (error) {
    customerList.innerHTML = `<p>Virhe asiakkaiden haussa: ${error}</p>`;
  }
}

customerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const customer = {
    id: customerIdInput && customerIdInput.value ? parseInt(customerIdInput.value) : null,
    name: document.getElementById("name").value,
    businessId: document.getElementById("businessId").value,
    address: document.getElementById("address").value,
    postalCode: document.getElementById("postalCode").value,
    city: document.getElementById("city").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value
  };

  try {
    let result;

    if (customer.id) {
      result = await ipcRenderer.invoke("update-customer", customer);
    } else {
      result = await ipcRenderer.invoke("add-customer", customer);
    }

    customerMessage.textContent = result.message;
    resetCustomerForm();
    await loadCustomers();
  } catch (error) {
    customerMessage.textContent = "Virhe asiakkaan tallennuksessa: " + error;
  }
});

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    resetCustomerForm();
    customerMessage.textContent = "";
  });
}

// =========================
// LASKURIVIT
// =========================
function createRowHtml() {
  const row = document.createElement("div");
  row.className = "invoice-row";

  row.innerHTML = `
    <input type="text" class="row-description" placeholder="Kuvaus" />
    <input type="number" class="row-quantity" placeholder="Määrä" value="1" min="0" step="0.01" />
    <input type="text" class="row-unit" placeholder="Yksikkö" value="kpl" />
    <input type="number" class="row-price" placeholder="Hinta" value="0" min="0" step="0.01" />
    <input type="number" class="row-vat" placeholder="ALV %" value="25.5" min="0" step="0.1" />
    <input type="text" class="row-total" placeholder="Rivisumma" readonly />
    <button type="button" class="remove-row-btn">Poista</button>
  `;

  const quantityInput = row.querySelector(".row-quantity");
  const priceInput = row.querySelector(".row-price");
  const vatInput = row.querySelector(".row-vat");
  const rowTotalInput = row.querySelector(".row-total");
  const removeBtn = row.querySelector(".remove-row-btn");

  function updateRowTotal() {
    const quantity = parseFloat(quantityInput.value) || 0;
    const price = parseFloat(priceInput.value) || 0;
    const vat = parseFloat(vatInput.value) || 0;

    const total = quantity * price * (1 + vat / 100);
    rowTotalInput.value = total.toFixed(2) + " €";

    updateInvoiceTotal();
  }

  quantityInput.addEventListener("input", updateRowTotal);
  priceInput.addEventListener("input", updateRowTotal);
  vatInput.addEventListener("input", updateRowTotal);

  removeBtn.addEventListener("click", () => {
    row.remove();
    updateInvoiceTotal();
  });

  updateRowTotal();
  return row;
}

function addInvoiceRow() {
  invoiceRows.appendChild(createRowHtml());
}

function getInvoiceRowsData() {
  const rows = [];
  const rowElements = document.querySelectorAll(".invoice-row");

  rowElements.forEach((row) => {
    const description = row.querySelector(".row-description").value;
    const quantity = parseFloat(row.querySelector(".row-quantity").value) || 0;
    const unit = row.querySelector(".row-unit").value;
    const price = parseFloat(row.querySelector(".row-price").value) || 0;
    const vat = parseFloat(row.querySelector(".row-vat").value) || 0;
    const subtotal = quantity * price;
    const vatAmount = subtotal * (vat / 100);
    const rowTotal = subtotal + vatAmount;

    if (description.trim() !== "") {
      rows.push({
        description,
        quantity,
        unit,
        price,
        vat,
        subtotal: parseFloat(subtotal.toFixed(2)),
        vatAmount: parseFloat(vatAmount.toFixed(2)),
        rowTotal: parseFloat(rowTotal.toFixed(2))
      });
    }
  });

  return rows;
}

function updateInvoiceTotal() {
  const rows = getInvoiceRowsData();

  const subtotal = rows.reduce((sum, row) => sum + row.subtotal, 0);
  const vatTotal = rows.reduce((sum, row) => sum + row.vatAmount, 0);
  const total = rows.reduce((sum, row) => sum + row.rowTotal, 0);

  invoiceSubtotal.textContent = subtotal.toFixed(2) + " €";
  invoiceVatTotal.textContent = vatTotal.toFixed(2) + " €";
  invoiceTotal.textContent = total.toFixed(2) + " €";
}

addRowBtn.addEventListener("click", addInvoiceRow);

// =========================
// VIITENUMERO
// =========================
function generateReferenceNumber(baseNumber) {
  const digitsOnly = String(baseNumber).replace(/\D/g, "");
  if (!digitsOnly) return "";

  const multipliers = [7, 3, 1];
  let sum = 0;
  let multiplierIndex = 0;

  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    sum += parseInt(digitsOnly[i], 10) * multipliers[multiplierIndex];
    multiplierIndex = (multiplierIndex + 1) % 3;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return digitsOnly + checkDigit;
}

invoiceNumberInput.addEventListener("input", () => {
  const invoiceNumber = invoiceNumberInput.value;
  referenceNumberInput.value = generateReferenceNumber(invoiceNumber);
});

// =========================
// LASKUN TALLENNUS
// =========================
invoiceForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rows = getInvoiceRowsData();

  if (rows.length === 0) {
    invoiceMessage.textContent = "Lisää vähintään yksi laskurivi.";
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.rowTotal, 0);

  const invoiceNumberValue = invoiceNumberInput.value;
  const autoReferenceNumber = generateReferenceNumber(invoiceNumberValue);

  const invoiceData = {
    customerId: parseInt(invoiceCustomer.value),
    invoiceNumber: invoiceNumberValue,
    date: document.getElementById("invoiceDate").value,
    dueDate: document.getElementById("invoiceDueDate").value,
    referenceNumber: autoReferenceNumber,
    total: parseFloat(total.toFixed(2)),
    rows
  };

  try {
    const result = await ipcRenderer.invoke("save-invoice", invoiceData);
    invoiceMessage.textContent = result.message;

    invoiceForm.reset();
    invoiceRows.innerHTML = "";
    addInvoiceRow();
    updateInvoiceTotal();

    setDefaultDates();
    await setNextInvoiceNumber();
    await loadInvoices();
  } catch (error) {
    invoiceMessage.textContent = "Virhe laskun tallennuksessa: " + error;
  }
});

// =========================
// LASKULISTA
// =========================
async function loadInvoices() {
  try {
    const invoices = await ipcRenderer.invoke("get-invoices");

    if (invoices.length === 0) {
      invoiceList.innerHTML = "<p>Ei laskuja vielä.</p>";
      return;
    }

    invoiceList.innerHTML = invoices
      .map(
        (invoice) => `
          <div class="invoice-card">
            <h3>Lasku ${invoice.invoiceNumber}</h3>
            <p><strong>Asiakas:</strong> ${invoice.customerName || "-"}</p>
            <p><strong>Päiväys:</strong> ${invoice.date}</p>
            <p><strong>Eräpäivä:</strong> ${invoice.dueDate}</p>
            <p><strong>Viite:</strong> ${invoice.referenceNumber || "-"}</p>
            <p><strong>Summa:</strong> ${Number(invoice.total).toFixed(2)} €</p>

            <p><strong>Tila:</strong></p>
            <select class="status-select" data-id="${invoice.id}">
              <option value="Luotu" ${invoice.status === "Luotu" ? "selected" : ""}>Luotu</option>
              <option value="Lähetetty" ${invoice.status === "Lähetetty" ? "selected" : ""}>Lähetetty</option>
              <option value="Maksettu" ${invoice.status === "Maksettu" ? "selected" : ""}>Maksettu</option>
            </select>

            <button class="pdf-btn" data-id="${invoice.id}">Luo PDF</button>
          </div>
        `
      )
      .join("");

    document.querySelectorAll(".pdf-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const invoiceId = parseInt(button.dataset.id);

        try {
          const result = await ipcRenderer.invoke("generate-invoice-pdf", invoiceId);
          alert(result);
        } catch (error) {
          alert("Virhe PDF:n luonnissa: " + error);
          console.error("PDF virhe:", error);
        }
      });
    });

    document.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", async () => {
        const invoiceId = parseInt(select.dataset.id);
        const newStatus = select.value;

        try {
          await ipcRenderer.invoke("update-invoice-status", invoiceId, newStatus);
          await loadInvoices();
        } catch (error) {
          alert("Virhe tilan päivityksessä: " + error);
        }
      });
    });
  } catch (error) {
    invoiceList.innerHTML = `<p>Virhe laskujen haussa: ${error}</p>`;
  }
}

// =========================
// ASETUKSET
// =========================
async function loadSettings() {
  try {
    const settings = await ipcRenderer.invoke("get-settings");

    document.getElementById("companyName").value = settings.companyName || "";
    document.getElementById("settingsBusinessId").value = settings.businessId || "";
    document.getElementById("settingsAddress").value = settings.address || "";
    document.getElementById("settingsPostalCode").value = settings.postalCode || "";
    document.getElementById("settingsCity").value = settings.city || "";
    document.getElementById("settingsEmail").value = settings.email || "";
    document.getElementById("settingsPhone").value = settings.phone || "";
    document.getElementById("settingsWebsite").value = settings.website || "";
    document.getElementById("settingsIban").value = settings.iban || "";
    document.getElementById("settingsBic").value = settings.bic || "";
    document.getElementById("settingsLogoPath").value = settings.logoPath || "";
  } catch (error) {
    settingsMessage.textContent = "Virhe asetusten haussa: " + error;
  }
}

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const settings = {
    companyName: document.getElementById("companyName").value,
    businessId: document.getElementById("settingsBusinessId").value,
    address: document.getElementById("settingsAddress").value,
    postalCode: document.getElementById("settingsPostalCode").value,
    city: document.getElementById("settingsCity").value,
    email: document.getElementById("settingsEmail").value,
    phone: document.getElementById("settingsPhone").value,
    website: document.getElementById("settingsWebsite").value,
    iban: document.getElementById("settingsIban").value,
    bic: document.getElementById("settingsBic").value,
    logoPath: document.getElementById("settingsLogoPath").value
  };

  try {
    const result = await ipcRenderer.invoke("save-settings", settings);
    settingsMessage.textContent = result.message;
  } catch (error) {
    settingsMessage.textContent = "Virhe asetusten tallennuksessa: " + error;
  }
});

// =========================
// OLETUSPÄIVÄMÄÄRÄT
// =========================
function setDefaultDates() {
  const today = new Date();
  const due = new Date();
  due.setDate(today.getDate() + 14);

  document.getElementById("invoiceDate").value = today.toISOString().split("T")[0];
  document.getElementById("invoiceDueDate").value = due.toISOString().split("T")[0];
}

// =========================
// LASKUNUMERON HAKEMINEN
// =========================
async function setNextInvoiceNumber() {
  try {
    const nextInvoiceNumber = await ipcRenderer.invoke("get-next-invoice-number");
    invoiceNumberInput.value = nextInvoiceNumber;
    referenceNumberInput.value = generateReferenceNumber(nextInvoiceNumber);
  } catch (error) {
    console.error("Virhe laskunumeron haussa:", error);
  }
}

// =========================
// ALUSTUS
// =========================
async function init() {
  setDefaultDates();
  addInvoiceRow();
  await loadCustomers();
  await loadInvoices();
  await loadSettings();
  await setNextInvoiceNumber();

  referenceNumberInput.value = generateReferenceNumber(invoiceNumberInput.value);
}

init();