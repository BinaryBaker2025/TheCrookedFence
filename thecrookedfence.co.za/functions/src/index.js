const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Resend } = require("resend");

admin.initializeApp();
const db = admin.firestore();

const BOOTSTRAP_ADMINS = [
  "bradsgbaker14@gmail.com",
  "admin@thecrookedfence.co.za",
  "stolschristopher60@gmail.com"
];

const ADMIN_EMAIL_EXCLUSIONS = new Set([
  "bradsgbaker14@gmail.com",
  "admin@thecrookedfence.co.za"
]);
const ADMIN_EMAIL_FALLBACKS = ["stolschristopher60@gmail.com"];

const ORDER_STATUS_LABELS = {
  pending: "Pending",
  waiting_list: "Waiting list",
  cancelled: "Cancelled",
  packed: "Packed",
  scheduled_dispatch: "Scheduled for Dispatch",
  shipped: "Shipped",
  completed: "Completed",
  archived: "Archived"
};

const ORDER_NUMBER_PAD = 4;
const WHATSAPP_NUMBER = "082 891 07612";
const BRAND_NAME = "The Crooked Fence";
const BRAND_LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/thecrookedfence-7aea9.firebasestorage.app/o/TCFLogoWhiteBackground.png?alt=media&token=24e50702-a2b8-42e9-b620-659b5d06d554";

const PAYMENT_DETAILS = {
  bank: "FNB/RMB",
  accountName: "The Golden Quail",
  accountType: "Gold Business Account",
  accountNumber: "63049448219",
  branchCode: "250655"
};

const EMAIL_STYLES = `
  body { margin:0; padding:0; background:#f8fafc; color:#0f172a; }
  .container { max-width:640px; margin:20px auto; padding:24px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; font-family:'Helvetica Neue', Arial, sans-serif; }
  h1,h2,h3 { color:#064e3b; margin:0 0 12px; }
  p { margin:6px 0; color:#334155; line-height:1.5; }
  ul { margin:6px 0; padding-left:20px; color:#334155; }
  li { margin-bottom:4px; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; background:#ecfdf3; color:#047857; font-weight:600; font-size:12px; }
  .summary { margin:16px 0; padding:14px; background:#f1f5f9; border-radius:12px; border:1px solid #e2e8f0; }
  .muted { color:#64748b; font-size:13px; }
  .total { font-size:18px; font-weight:700; color:#064e3b; }
  .divider { border-bottom:1px solid #e2e8f0; margin:16px 0; }
  a { color:#0f766e; }
`;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value) => `R${toNumber(value).toFixed(2)}`;

const formatDate = (value) => {
  if (!value) return "-";
  if (value.toDate) return value.toDate().toLocaleDateString();
  if (value.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
  return new Date(value).toLocaleDateString();
};

const parseOrderNumber = (value) => {
  if (!value) return 0;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
};

const formatOrderNumber = (value) => `#${String(value).padStart(ORDER_NUMBER_PAD, "0")}`;

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
};

const getCustomerName = (order) => {
  const full = [order?.name, order?.surname].filter(Boolean).join(" ").trim();
  return full || "Customer";
};

const getOrderStatusLabel = (status) => ORDER_STATUS_LABELS[status] || status || "-";

const getPaidLabel = (order) => {
  const raw = order?.paid;
  if (raw === true) return "Yes";
  if (raw === false) return "No";
  if (raw === null || raw === undefined) return "No";
  const normalized = String(raw).trim().toLowerCase();
  if (["yes", "paid", "true"].includes(normalized)) return "Yes";
  if (["no", "unpaid", "false"].includes(normalized)) return "No";
  return String(raw);
};

const getUnitPrice = (item) => {
  const special = item?.specialPrice;
  const specialValue = toNumber(special);
  if (special === null || special === undefined || specialValue === 0) {
    return toNumber(item?.price);
  }
  return specialValue;
};

const buildItemBreakdownHtml = (items) => {
  const lines = (Array.isArray(items) ? items : [])
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const qty = toNumber(item.quantity);
      const unitPrice = getUnitPrice(item);
      const lineTotal = unitPrice * qty;
      return `${escapeHtml(item.label)} x ${qty} @ ${formatCurrency(
        unitPrice
      )} = ${formatCurrency(lineTotal)}`;
    });
  return lines.length ? lines.join("<br/>") : "No items listed.";
};

const buildItemBreakdownListHtml = (items) => {
  const lines = (Array.isArray(items) ? items : [])
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const qty = toNumber(item.quantity);
      const unitPrice = getUnitPrice(item);
      const lineTotal = unitPrice * qty;
      return `<li>${escapeHtml(item.label)} x ${qty} @ ${formatCurrency(
        unitPrice
      )} = ${formatCurrency(lineTotal)}</li>`;
    });
  if (lines.length === 0) return "<li>No items listed.</li>";
  return lines.join("");
};

const buildEmailHeaderHtml = () => `
  <div style="margin-bottom:12px; text-align:center;">
    <div style="display:inline-flex; align-items:center; justify-content:center; gap:12px;">
      <img src="${BRAND_LOGO_URL}" alt="${BRAND_NAME}" style="height:80px; width:auto; border-radius:12px; border:1px solid #e2e8f0;" />
      <span style="font-weight:700; color:#0f172a; font-size:20px;">${BRAND_NAME}</span>
    </div>
  </div>
`;

const buildEmailHtml = ({ title, intro, preheader, body, footer }) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <title>${escapeHtml(title || BRAND_NAME)}</title>
      <style>${EMAIL_STYLES}</style>
    </head>
    <body>
      <div class="container">
        ${
          preheader
            ? `<span style="display:none; font-size:1px; color:#f8fafc; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${escapeHtml(
                preheader
              )}</span>`
            : ""
        }
        ${intro ? `<p class="muted" style="margin-top:0;">${escapeHtml(intro)}</p>` : ""}
        ${buildEmailHeaderHtml()}
        ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
        ${body || ""}
        ${footer || ""}
      </div>
    </body>
  </html>
`;

const buildPaymentSectionHtml = (orderNumber) => {
  const reference = orderNumber
    ? `your name or order number (${escapeHtml(orderNumber)})`
    : "your name";
  return `
    <div class="divider"></div>
    <h3 style="margin: 0 0 8px;">Payment</h3>
    <p>We are an <strong>EFT and Cash Only</strong> business. Please use the details below to make an EFT payment:</p>
    <p style="margin: 0;"><strong>Bank:</strong> ${PAYMENT_DETAILS.bank}</p>
    <p style="margin: 0;"><strong>Account Name:</strong> ${PAYMENT_DETAILS.accountName}</p>
    <p style="margin: 0;"><strong>Account Type:</strong> ${PAYMENT_DETAILS.accountType}</p>
    <p style="margin: 0;"><strong>Account Number:</strong> ${PAYMENT_DETAILS.accountNumber}</p>
    <p style="margin: 0 0 4px 0;"><strong>Branch Code:</strong> ${PAYMENT_DETAILS.branchCode}</p>
    <p class="muted">Reference: ${reference}</p>
  `;
};

const buildOrderSummaryCard = ({ heading, items, totals, collectionName }) => {
  const itemLabel = collectionName === "livestockOrders" ? "Items" : "Eggs";
  return `
    <div class="summary">
      <h3 style="margin: 0 0 8px;">${escapeHtml(heading)}</h3>
      <p style="margin: 0 0 8px;">${buildItemBreakdownHtml(items)}</p>
      <p><strong>${itemLabel} total:</strong> ${formatCurrency(totals.subtotal)}</p>
      <p><strong>Delivery:</strong> ${formatCurrency(totals.delivery)}</p>
      <p class="total">Grand total: ${formatCurrency(totals.total)}</p>
    </div>
  `;
};

const getRoleFromContext = (context) => {
  const email = context.auth?.token?.email?.toLowerCase?.() ?? "";
  const claimRole = context.auth?.token?.role ?? null;
  if (claimRole) return claimRole;
  if (BOOTSTRAP_ADMINS.includes(email)) return "admin";
  return null;
};

const requireAdmin = (context) => {
  const role = getRoleFromContext(context);
  if (role !== "admin" && role !== "super_admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin access required.");
  }
};

const requireStaff = (context) => {
  const role = getRoleFromContext(context);
  if (role !== "admin" && role !== "super_admin" && role !== "worker") {
    throw new functions.https.HttpsError("permission-denied", "Staff access required.");
  }
};

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY || functions.config()?.resend?.api_key;
  return apiKey ? new Resend(apiKey) : null;
};

const getResendFrom = () => {
  return (
    process.env.RESEND_FROM ||
    functions.config()?.resend?.from ||
    "The Crooked Fence <no-reply@thecrookedfence.co.za>"
  );
};

const getAdminRecipients = () => {
  const email = process.env.ADMIN_EMAIL || functions.config()?.admin?.email || "";
  if (!email) return [];
  const recipients = String(email)
    .split(/[;,\s]+/)
    .map((address) => address.trim())
    .filter((address) => address && !ADMIN_EMAIL_EXCLUSIONS.has(address.toLowerCase()));
  return recipients.length > 0 ? recipients : ADMIN_EMAIL_FALLBACKS;
};

const sendEmail = async ({ to, subject, html, text }) => {
  const resend = getResendClient();
  if (!resend) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Resend API key is not configured."
    );
  }
  const recipients = Array.isArray(to) ? to : [to];
  const filtered = recipients.filter(Boolean);
  if (filtered.length === 0) return null;

  return resend.emails.send({
    from: getResendFrom(),
    to: filtered,
    subject,
    html,
    text
  });
};

const getOrderItems = (order) => (Array.isArray(order.eggs) ? order.eggs : []);

const calculateOrderTotals = (order) => {
  const items = getOrderItems(order);
  const subtotal = items.reduce((sum, item) => {
    const qty = toNumber(item.quantity);
    if (!qty) return sum;
    const special = item.specialPrice;
    const unitPrice =
      special === null || special === undefined || toNumber(special) === 0
        ? toNumber(item.price)
        : toNumber(special);
    return sum + unitPrice * qty;
  }, 0);
  const delivery = toNumber(order.deliveryCost);
  return { subtotal, delivery, total: subtotal + delivery };
};

const buildItemSummary = (items) => {
  const lines = items
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => `${item.label} x ${item.quantity}`);
  return lines.length ? lines.join(", ") : "No items listed";
};

const buildItemListHtml = (items) => buildItemBreakdownListHtml(items);

const assignOrderNumber = async (collectionName, orderRef) => {
  const counterRef = db.collection("orderCounters").doc(collectionName);
  const nextNumber = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let lastNumber = 0;
    if (counterSnap.exists) {
      lastNumber = toNumber(counterSnap.data().lastNumber);
    } else {
      const latestQuery = db
        .collection(collectionName)
        .orderBy("orderNumber", "desc")
        .limit(1);
      const latestSnap = await tx.get(latestQuery);
      if (!latestSnap.empty) {
        lastNumber = parseOrderNumber(latestSnap.docs[0].data().orderNumber);
      }
    }
    const next = lastNumber + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });
  const formatted = formatOrderNumber(nextNumber);
  await orderRef.set({ orderNumber: formatted }, { merge: true });
  return formatted;
};

const ensureOrderNumber = async (collectionName, orderRef, orderData) => {
  if (orderData.orderNumber) return orderData.orderNumber;
  return assignOrderNumber(collectionName, orderRef);
};

const sendOrderCreatedEmails = async ({ order, collectionName }) => {
  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const paidLabel = getPaidLabel(order);
  const name = getCustomerName(order);
  const orderNumber = order.orderNumber || "";
  const orderNumberLabel = orderNumber ? ` ${orderNumber}` : "";
  const deliveryLabel = order.deliveryOption || "";
  const sendDate = order.sendDate || "";
  const notes = order.notes || "";
  const statusLabel = getOrderStatusLabel(order.orderStatus || "pending");
  const paidLabel = getPaidLabel(order);
  const orderTypeLabel = collectionName === "livestockOrders" ? "livestock" : "egg";
  const intro = `We’ve received your ${orderTypeLabel} order and will keep you updated.`;
  const whatsappLine = `Please follow up via WhatsApp (${WHATSAPP_NUMBER}) for order updates and to confirm payment by sending proof of payment.`;

  const summaryCard = buildOrderSummaryCard({
    heading: "Your order",
    items,
    totals,
    collectionName
  });

  const detailLines = `
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    ${orderNumber ? `<p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
    <p><strong>Status:</strong> ${escapeHtml(statusLabel)}</p>
    <p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>
    ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
    <p class="muted">If you need to change anything, reply to this email.</p>
    <p class="muted">${escapeHtml(whatsappLine)}</p>
  `;

  const customerBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(intro)}</p>
    ${summaryCard}
    ${detailLines}
    ${buildPaymentSectionHtml(orderNumber)}
  `;

  const customerHtml = buildEmailHtml({
    title: "Thank you for your order!",
    intro,
    preheader: intro,
    body: customerBody
  });

  const adminRecipients = getAdminRecipients();
  const adminIntro = `A new ${orderTypeLabel} order has been placed.`;
  const adminSummary = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName
  });
  const adminBody = `
    <p><strong>Customer:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(order.email || "-")}</p>
    <p><strong>Cellphone:</strong> ${escapeHtml(order.cellphone || "-")}</p>
    <p><strong>Address:</strong> ${escapeHtml(order.address || "-")}</p>
    ${adminSummary}
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    ${orderNumber ? `<p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
    <p><strong>Status:</strong> ${escapeHtml(statusLabel)}</p>
    <p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>
    ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
    <p><strong>Items:</strong></p>
    <ul>${buildItemListHtml(items)}</ul>
    <p><strong>Order ID:</strong> ${escapeHtml(order.id || "-")}</p>
  `;

  const adminHtml = buildEmailHtml({
    title: `New ${orderTypeLabel} order${orderNumberLabel}`,
    intro: adminIntro,
    preheader: adminIntro,
    body: adminBody
  });

  if (order.email) {
    await sendEmail({
      to: [order.email],
      subject: `Your order${orderNumberLabel} with ${BRAND_NAME}`,
      html: customerHtml
    });
  }

  if (adminRecipients.length > 0) {
    await sendEmail({
      to: adminRecipients,
      subject: `New ${orderTypeLabel} order${orderNumberLabel}`,
      html: adminHtml
    });
  }
};

const sendOrderStatusEmails = async ({ order, previousStatus, nextStatus, collectionName }) => {
  const suppressed = new Set(["archived", "cancelled"]);
  if (!nextStatus || suppressed.has(nextStatus)) return;

  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const name = getCustomerName(order);
  const orderNumber = order.orderNumber || "";
  const orderNumberLabel = orderNumber ? ` ${orderNumber}` : "";
  const statusLabel = getOrderStatusLabel(nextStatus);
  const trackingLink = normalizeUrl(order.trackingLink || "");
  const deliveryLabel = order.deliveryOption || "";
  const sendDate = order.sendDate || "";
  const intro = `Your order status has been updated to ${statusLabel}.`;
  const paidLabel = getPaidLabel(order);
  const summaryCard = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName
  });

  const trackingLine = trackingLink
    ? `<p><strong>Tracking:</strong> <a href="${escapeHtml(trackingLink)}">${escapeHtml(
        trackingLink
      )}</a></p>`
    : "";

  const customerBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your order${orderNumberLabel} status has been updated.</p>
    <p><span class="pill">${escapeHtml(statusLabel)}</span></p>
    ${summaryCard}
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    <p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>
    ${trackingLine}
    <p class="muted">If you have questions, reply to this email.</p>
  `;

  const customerHtml = buildEmailHtml({
    title: "Order status update",
    intro,
    preheader: intro,
    body: customerBody
  });

  const adminRecipients = getAdminRecipients();
  const adminIntro = `Order status updated to ${statusLabel}.`;
  const adminBody = `
    <p><strong>Order:</strong> ${escapeHtml(orderNumber || order.id || "-")}</p>
    <p><strong>Customer:</strong> ${escapeHtml(name)}</p>
    <p><strong>Previous status:</strong> ${escapeHtml(
      getOrderStatusLabel(previousStatus)
    )}</p>
    <p><strong>New status:</strong> ${escapeHtml(statusLabel)}</p>
    ${trackingLine}
    ${summaryCard}
    <p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>
  `;

  const adminHtml = buildEmailHtml({
    title: `Order status updated${orderNumberLabel}`,
    intro: adminIntro,
    preheader: adminIntro,
    body: adminBody
  });

  if (order.email) {
    await sendEmail({
      to: [order.email],
      subject: `Your order${orderNumberLabel} status update`,
      html: customerHtml
    });
  }

  if (adminRecipients.length > 0) {
    await sendEmail({
      to: adminRecipients,
      subject: `Order status updated${orderNumberLabel}`,
      html: adminHtml
    });
  }
};

const loadStockData = async () => {
  const [itemsSnap, categoriesSnap] = await Promise.all([
    db.collection("stockItems").orderBy("name", "asc").get(),
    db.collection("stockCategories").orderBy("name", "asc").get()
  ]);

  const categoryLookup = new Map();
  categoriesSnap.forEach((docSnap) => {
    categoryLookup.set(docSnap.id, docSnap.data().name || "Uncategorized");
  });

  const items = itemsSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      name: data.name || "Unnamed",
      category: categoryLookup.get(data.categoryId) || data.category || "",
      subCategory: data.subCategory || "",
      quantity: toNumber(data.quantity),
      threshold: toNumber(data.threshold),
      notes: data.notes || ""
    };
  });

  return items;
};

const buildStockSummaryHtml = (items, includeAll) => {
  const lowStock = items.filter(
    (item) => item.threshold > 0 && item.quantity <= item.threshold
  );
  const list = includeAll ? items : lowStock;

  const listHtml = list.length
    ? `<ul>${list
        .map((item) => {
          const categoryLabel = [item.category, item.subCategory]
            .filter(Boolean)
            .join(" / ");
          const label = categoryLabel
            ? `${escapeHtml(item.name)} (${escapeHtml(categoryLabel)})`
            : escapeHtml(item.name);
          const lowFlag =
            item.threshold > 0 && item.quantity <= item.threshold ? " <strong>(LOW)</strong>" : "";
          return `<li>${label}: ${item.quantity} (threshold ${item.threshold || "-"})${lowFlag}</li>`;
        })
        .join("")}</ul>`
    : "<p>No items to report.</p>";

  return `
    <div class="summary">
      <p><strong>Total items:</strong> ${items.length}</p>
      <p><strong>Low stock items:</strong> ${lowStock.length}</p>
      ${listHtml}
    </div>
  `;
};

const sendStockSummaryEmail = async ({ title, includeAll }) => {
  const items = await loadStockData();
  const adminRecipients = getAdminRecipients();
  if (adminRecipients.length === 0) return null;

  const intro = "Here is the latest stock summary report.";
  const html = buildEmailHtml({
    title,
    intro,
    preheader: intro,
    body: buildStockSummaryHtml(items, includeAll)
  });

  return sendEmail({
    to: adminRecipients,
    subject: title,
    html
  });
};

exports.ensureCurrentUserProfile = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }

  const uid = context.auth.uid;
  const email = context.auth.token.email || "";
  const role = getRoleFromContext(context) ?? null;

  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    await userRef.set({
      email,
      role,
      disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await userRef.set(
      {
        email,
        role: role ?? snapshot.data()?.role ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  return { uid, email, role };
});

exports.createUserProfile = functions.auth.user().onCreate(async (user) => {
  const email = String(user.email || "").toLowerCase();
  let role = user.customClaims?.role ?? null;
  if (!role && BOOTSTRAP_ADMINS.includes(email)) {
    role = "admin";
    const claims = { ...(user.customClaims || {}) };
    if (!claims.role) {
      claims.role = role;
      await admin.auth().setCustomUserClaims(user.uid, claims);
    }
  }

  await db.collection("users").doc(user.uid).set(
    {
      email: user.email || "",
      role,
      disabled: Boolean(user.disabled),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
});

exports.createAuthUser = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const email = String(data.email || "").trim().toLowerCase();
  const role = String(data.role || "worker").trim();
  const password = String(data.password || "").trim();

  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "Email is required.");
  }

  const generatedPassword = password || `Temp${Math.random().toString(36).slice(-8)}!`;

  const userRecord = await admin.auth().createUser({
    email,
    password: generatedPassword
  });

  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  await db.collection("users").doc(userRecord.uid).set({
    email,
    role,
    disabled: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    uid: userRecord.uid,
    temporaryPassword: password ? null : generatedPassword
  };
});

exports.updateAuthUserStatus = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  const disabled = Boolean(data.disabled);

  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "User id is required.");
  }

  await admin.auth().updateUser(uid, { disabled });

  await db.collection("users").doc(uid).set(
    {
      disabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { uid, disabled };
});

exports.updateAuthUserRole = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  const role = String(data.role || "").trim();
  const allowedRoles = new Set(["worker", "admin", "super_admin"]);

  if (!uid || !allowedRoles.has(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Valid user id and role are required.");
  }

  const userRecord = await admin.auth().getUser(uid);
  const claims = { ...(userRecord.customClaims || {}), role };
  await admin.auth().setCustomUserClaims(uid, claims);

  await db.collection("users").doc(uid).set(
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { uid, role };
});

exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "User id is required.");
  }

  await admin.auth().deleteUser(uid);
  await db.collection("users").doc(uid).delete();

  return { uid };
});

exports.deleteCategoryWithItems = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const categoryId = String(data.categoryId || "").trim();
  if (!categoryId) {
    throw new functions.https.HttpsError("invalid-argument", "Category id is required.");
  }

  const itemsQuery = await db
    .collection("stockItems")
    .where("categoryId", "==", categoryId)
    .get();

  const batch = db.batch();
  itemsQuery.forEach((docSnap) => batch.delete(docSnap.ref));
  batch.delete(db.collection("stockCategories").doc(categoryId));

  await batch.commit();

  return { deletedItems: itemsQuery.size };
});

exports.sendDispatchEmail = functions.https.onCall(async (data, context) => {
  requireStaff(context);

  const collectionName = String(data?.collectionName || "").trim();
  if (!["eggOrders", "livestockOrders"].includes(collectionName)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid collection name.");
  }

  const orderId = String(data?.orderId || "").trim();
  if (!orderId) {
    throw new functions.https.HttpsError("invalid-argument", "Order id is required.");
  }

  const orderRef = db.collection(collectionName).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Order not found.");
  }

  const order = orderSnap.data() || {};
  const email = String(order.email || "").trim();
  if (!email) {
    throw new functions.https.HttpsError("failed-precondition", "Order email is missing.");
  }

  const name = [order.name, order.surname].filter(Boolean).join(" ").trim() || "Customer";
  const orderNumberLabel = order.orderNumber ? ` ${order.orderNumber}` : "";
  const sendDate = order.sendDate || "";
  const delivery = order.deliveryOption || "";
  const trackingLink = normalizeUrl(order.trackingLink || "");
  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const summaryCard = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName
  });

  const trackingLine = trackingLink
    ? `<p><strong>Tracking:</strong> <a href="${escapeHtml(trackingLink)}">${escapeHtml(
        trackingLink
      )}</a></p>`
    : "";

  const intro = `Your order${orderNumberLabel} is being prepared for dispatch.`;
  const subject = `Your order${orderNumberLabel} update from ${BRAND_NAME}`;
  const html = buildEmailHtml({
    title: "Dispatch update",
    intro,
    preheader: intro,
    body: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your order${orderNumberLabel} is being prepared for dispatch.</p>
      ${summaryCard}
      ${delivery ? `<p><strong>Delivery option:</strong> ${escapeHtml(delivery)}</p>` : ""}
      ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
      <p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>
      ${trackingLine}
      <p class="muted">If you have questions, reply to this email.</p>
    `
  });

  const result = await sendEmail({
    to: [email],
    subject,
    html
  });

  await orderRef.set(
    { dispatchEmailSentAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { id: result?.data?.id || null };
});

exports.sendTestEmail = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const to = Array.isArray(data?.to) ? data.to : [data?.to || ""];
  const subject = data?.subject || "The Crooked Fence test email";
  const rawHtml = data?.html || "<p>It works!</p>";
  const useRawHtml = Boolean(data?.useRawHtml);
  const html = useRawHtml
    ? rawHtml
    : buildEmailHtml({
        title: subject,
        intro: "Test email",
        preheader: "Test email",
        body: rawHtml
      });

  const result = await sendEmail({ to, subject, html });

  return { id: result?.data?.id || null };
});

exports.emailOnOrderCreate = functions.firestore
  .document("eggOrders/{orderId}")
  .onCreate(async (snap) => {
    const orderRef = snap.ref;
    const order = snap.data() || {};
    const orderNumber = await ensureOrderNumber("eggOrders", orderRef, order);
    await sendOrderCreatedEmails({
      order: { ...order, orderNumber, id: snap.id },
      collectionName: "eggOrders"
    });
  });

exports.emailOnLivestockOrderCreate = functions.firestore
  .document("livestockOrders/{orderId}")
  .onCreate(async (snap) => {
    const orderRef = snap.ref;
    const order = snap.data() || {};
    const orderNumber = await ensureOrderNumber("livestockOrders", orderRef, order);
    await sendOrderCreatedEmails({
      order: { ...order, orderNumber, id: snap.id },
      collectionName: "livestockOrders"
    });
  });

exports.emailOnStatusChange = functions.firestore
  .document("eggOrders/{orderId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.orderStatus === after.orderStatus) return null;

    const orderNumber = after.orderNumber || before.orderNumber || "";
    await sendOrderStatusEmails({
      order: { ...after, orderNumber, id: change.after.id },
      previousStatus: before.orderStatus,
      nextStatus: after.orderStatus,
      collectionName: "eggOrders"
    });
    return null;
  });

exports.emailOnLivestockStatusChange = functions.firestore
  .document("livestockOrders/{orderId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.orderStatus === after.orderStatus) return null;

    const orderNumber = after.orderNumber || before.orderNumber || "";
    await sendOrderStatusEmails({
      order: { ...after, orderNumber, id: change.after.id },
      previousStatus: before.orderStatus,
      nextStatus: after.orderStatus,
      collectionName: "livestockOrders"
    });
    return null;
  });

exports.stockThresholdAlert = functions.firestore
  .document("stockItems/{itemId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const after = change.after.data() || {};
    const before = change.before.exists ? change.before.data() || {} : null;

    const threshold = toNumber(after.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    const afterQty = toNumber(after.quantity);
    const beforeQty = before ? toNumber(before.quantity) : null;

    if (before && beforeQty <= threshold) {
      if (afterQty <= threshold) return null;
      return null;
    }

    if ((beforeQty === null || beforeQty > threshold) && afterQty <= threshold) {
      const adminRecipients = getAdminRecipients();
      if (adminRecipients.length === 0) return null;
      const name = escapeHtml(after.name || "Stock item");
      const subject = `Stock alert: ${after.name || "Item"} low`;
      const intro = `${after.name || "Item"} is now below threshold.`;
      const html = buildEmailHtml({
        title: "Stock threshold alert",
        intro,
        preheader: intro,
        body: `
          <p><strong>${name}</strong> is now below threshold.</p>
          <div class="summary">
            <p><strong>Quantity:</strong> ${afterQty}</p>
            <p><strong>Threshold:</strong> ${threshold}</p>
          </div>
        `
      });
      await sendEmail({ to: adminRecipients, subject, html });
    }
    return null;
  });

exports.stockMorningSummary = functions.pubsub
  .schedule("0 8 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Morning stock summary",
      includeAll: false
    })
  );

exports.stockEveningSummary = functions.pubsub
  .schedule("0 18 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Evening stock summary",
      includeAll: false
    })
  );

exports.stockDailyFullSummary = functions.pubsub
  .schedule("0 20 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Daily stock summary",
      includeAll: true
    })
  );

exports.sendStockTestEmail = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const result = await sendStockSummaryEmail({
    title: "Stock summary test",
    includeAll: true
  });
  return { id: result?.data?.id || null };
});

const chunkedWrite = async (docs, handler) => {
  const chunks = [];
  const size = 400;
  for (let i = 0; i < docs.length; i += size) {
    chunks.push(docs.slice(i, i + size));
  }
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((doc) => handler(batch, doc));
    await batch.commit();
  }
};

exports.syncAuthUsers = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);

  const allUsers = [];
  let nextPageToken;
  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    allUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  await chunkedWrite(allUsers, (batch, user) => {
    const claimRole = user.customClaims?.role;
    const payload = {
      email: user.email || "",
      disabled: Boolean(user.disabled),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (claimRole) {
      payload.role = claimRole;
    }
    const ref = db.collection("users").doc(user.uid);
    batch.set(ref, payload, { merge: true });
  });

  return { count: allUsers.length };
});

exports.promoteAllUsersToAdmin = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);

  const allUsers = [];
  let nextPageToken;
  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    allUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  for (const user of allUsers) {
    await admin.auth().setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      role: "admin"
    });
    await db.collection("users").doc(user.uid).set(
      {
        role: "admin",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  return { count: allUsers.length };
});

exports.sendLegacyCorrectionEmails = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const collectionName = String(data?.collectionName || "eggOrders");
  const orderIds = Array.isArray(data?.orderIds) ? data.orderIds : [];
  if (!orderIds.length) {
    throw new functions.https.HttpsError("invalid-argument", "Order ids are required.");
  }

  const subject = data?.subject || "Order update from The Crooked Fence";
  const message = data?.message || "Please note an update to your order.";

  const results = [];
  for (const orderId of orderIds) {
    const snap = await db.collection(collectionName).doc(orderId).get();
    if (!snap.exists) continue;
    const order = snap.data() || {};
    if (!order.email) continue;
    const name = [order.name, order.surname].filter(Boolean).join(" ").trim() || "Customer";
    const orderNumber = order.orderNumber || "";
    const body = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>${escapeHtml(message)}</p>
      ${orderNumber ? `<p><strong>Order reference:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
      <p class="muted">If you have questions, reply to this email.</p>
    `;
    const html = buildEmailHtml({
      title: subject,
      intro: message,
      preheader: message,
      body
    });
    const result = await sendEmail({ to: [order.email], subject, html });
    results.push({ id: orderId, email: order.email, result: result?.data?.id || null });
  }

  return { sent: results.length, results };
});
