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
  const resend = getResendClient();

  if (!resend) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Resend API key is not configured."
    );
  }

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
  const trackingLink = order.trackingLink || "";
  const items = Array.isArray(order.eggs) ? order.eggs : [];
  const itemSummary = items
    .filter((item) => Number(item.quantity ?? 0) > 0)
    .map((item) => `${item.label} x ${item.quantity}`)
    .join(", ");

  const sendDateLine = sendDate ? `<p><strong>Send date:</strong> ${sendDate}</p>` : "";
  const deliveryLine = delivery ? `<p><strong>Delivery:</strong> ${delivery}</p>` : "";
  const itemLine = itemSummary ? `<p><strong>Items:</strong> ${itemSummary}</p>` : "";
  const trackingLine = trackingLink
    ? `<p><strong>Tracking:</strong> <a href="${trackingLink}">${trackingLink}</a></p>`
    : "";

  const subject = `Your order${orderNumberLabel} update from The Crooked Fence`;
  const html = `
    <p>Hi ${name},</p>
    <p>Your order${orderNumberLabel} is being prepared for dispatch.</p>
    ${sendDateLine}
    ${deliveryLine}
    ${itemLine}
    ${trackingLine}
    <p>If you have questions, reply to this email.</p>
    <p>Thank you,</p>
    <p>The Crooked Fence</p>
  `;

  const result = await resend.emails.send({
    from: "The Crooked Fence <no-reply@thecrookedfence.co.za>",
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
  const resend = getResendClient();

  if (!resend) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Resend API key is not configured."
    );
  }

  const to = Array.isArray(data?.to) ? data.to : [data?.to || ""]; 
  const subject = data?.subject || "The Crooked Fence test email";
  const html = data?.html || "<p>It works!</p>";

  const result = await resend.emails.send({
    from: data?.from || "The Crooked Fence <no-reply@thecrookedfence.co.za>",
    to,
    subject,
    html
  });

  return { id: result?.data?.id || null };
});
