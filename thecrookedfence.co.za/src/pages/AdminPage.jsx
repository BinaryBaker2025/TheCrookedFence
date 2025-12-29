import { useEffect, useMemo, useState } from "react";
import {
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, functions, storage } from "../lib/firebase.js";
import {
  DEFAULT_DELIVERY_OPTIONS,
  DEFAULT_EGG_TYPES,
  DEFAULT_FORM_DELIVERY_OPTIONS,
  DEFAULT_LIVESTOCK_DELIVERY_OPTIONS,
  FINANCE_ATTACHMENTS,
  INVENTORY_SORT_OPTIONS,
  ORDER_STATUSES,
  STATUS_STYLES,
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL
} from "../data/defaults.js";

const cardClass = "bg-brandBeige shadow-lg rounded-2xl border border-brandGreen/10";
const panelClass = "rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner";
const inputClass =
  "w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";
const mutedText = "text-brandGreen/70";

const formatTimestamp = (value) => {
  if (!value) return "-";
  if (value.toDate) return value.toDate().toLocaleString();
  if (value.seconds) return new Date(value.seconds * 1000).toLocaleString();
  return new Date(value).toLocaleString();
};

const formatDate = (value) => {
  if (!value) return "-";
  if (value.toDate) return value.toDate().toLocaleDateString();
  if (value.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
  return new Date(value).toLocaleDateString();
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `R${Number(value).toFixed(2)}`;
};

const extractCost = (label) => {
  if (!label) return 0;
  const match = label.match(/R\s*([\d.]+)/i);
  return match ? Number(match[1]) : 0;
};

const ORDER_ATTACHMENTS = FINANCE_ATTACHMENTS;

const createLineId = () =>
  `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const useAuthRole = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser ?? null);
      if (!nextUser) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const token = await getIdTokenResult(nextUser);
        const claimRole = token?.claims?.role;
        setRole(claimRole ?? null);
      } catch (err) {
        console.error("getIdTokenResult error", err);
        setRole(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return { user, role, loading, setRole };
};

export default function AdminPage() {
  const { user, role, loading, setRole } = useAuthRole();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const ensureProfile = httpsCallable(functions, "ensureCurrentUserProfile");
    ensureProfile().catch((err) => console.error("ensureCurrentUserProfile error", err));
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const ref = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const nextRole = snapshot.data()?.role ?? null;
        if (!role && nextRole) setRole(nextRole);
      },
      (err) => console.error("role snapshot error", err)
    );
    return () => unsubscribe();
  }, [user, role, setRole]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginForm.email.trim(), loginForm.password);
      setLoginForm({ email: "", password: "" });
    } catch (err) {
      console.error("login error", err);
      setLoginError("Login failed. Please check your credentials.");
    } finally {
      setLoginLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`${cardClass} p-6 text-sm ${mutedText}`}>
        Loading admin tools...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className={`${cardClass} p-6 text-center`}>
          <h1 className="text-2xl font-bold text-brandGreen">Admin Login</h1>
          <p className={`mt-2 text-sm ${mutedText}`}>
            Sign in with your admin or worker credentials.
          </p>
        </div>
        <form onSubmit={handleLogin} className={`${cardClass} space-y-4 p-6`}>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brandGreen">Email</label>
            <input
              type="email"
              className={inputClass}
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((prev) => ({ ...prev, email: event.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brandGreen">Password</label>
            <input
              type="password"
              className={inputClass}
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((prev) => ({ ...prev, password: event.target.value }))
              }
              required
            />
          </div>
          {loginError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loginError}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loginLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return <AdminDashboard user={user} role={role} />;
}

function AdminDashboard({ user, role }) {
  const isAdmin = role === "admin" || role === "super_admin";
  const isWorker = role === "worker";

  const [activeTab, setActiveTab] = useState(isWorker ? "stock_updates" : "orders");
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    if (isWorker) setActiveTab("stock_updates");
  }, [isWorker]);

  useEffect(() => {
    if (!openMenu) return undefined;
    const handleClick = () => setOpenMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openMenu]);

  const [eggOrders, setEggOrders] = useState([]);
  const [livestockOrders, setLivestockOrders] = useState([]);
  const [eggTypes, setEggTypes] = useState([]);
  const [deliveryOptions, setDeliveryOptions] = useState([]);
  const [livestockDeliveryOptions, setLivestockDeliveryOptions] = useState([]);
  const [livestockCategories, setLivestockCategories] = useState([]);
  const [livestockTypes, setLivestockTypes] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);
  const [stockUpdateLogs, setStockUpdateLogs] = useState([]);
  const [stockCategories, setStockCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [financeEntries, setFinanceEntries] = useState([]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState("orderNumberDesc");
  const [orderActionMessage, setOrderActionMessage] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderCollection, setSelectedOrderCollection] = useState("eggOrders");

  const [eggDraft, setEggDraft] = useState({ label: "", price: "", specialPrice: "" });
  const [eggEdits, setEggEdits] = useState({});
  const [eggMessage, setEggMessage] = useState("");
  const [eggError, setEggError] = useState("");

  const [deliveryDraft, setDeliveryDraft] = useState({ label: "", cost: "" });
  const [deliveryEdits, setDeliveryEdits] = useState({});
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [deliveryError, setDeliveryError] = useState("");

  const [livestockDeliveryDraft, setLivestockDeliveryDraft] = useState({
    label: "",
    cost: ""
  });
  const [livestockDeliveryEdits, setLivestockDeliveryEdits] = useState({});
  const [livestockDeliveryMessage, setLivestockDeliveryMessage] = useState("");
  const [livestockDeliveryError, setLivestockDeliveryError] = useState("");

  const [categoryDraft, setCategoryDraft] = useState({ name: "", description: "" });
  const [categoryMessage, setCategoryMessage] = useState("");
  const [categoryError, setCategoryError] = useState("");

  const [livestockDraft, setLivestockDraft] = useState({
    label: "",
    price: "",
    specialPrice: "",
    categoryId: ""
  });
  const [livestockEdits, setLivestockEdits] = useState({});
  const [livestockMessage, setLivestockMessage] = useState("");
  const [livestockError, setLivestockError] = useState("");

  const [stockCategoryDraft, setStockCategoryDraft] = useState({ name: "" });
  const [stockCategoryMessage, setStockCategoryMessage] = useState("");
  const [stockCategoryError, setStockCategoryError] = useState("");

  const [stockItemDraft, setStockItemDraft] = useState({
    name: "",
    categoryId: "",
    subCategory: "",
    quantity: "",
    threshold: "5",
    notes: ""
  });
  const [stockItemError, setStockItemError] = useState("");

  const [stockSearch, setStockSearch] = useState("");
  const [stockSort, setStockSort] = useState("name_asc");
  const [stockCategoryFilter, setStockCategoryFilter] = useState("all");

  const [userDraft, setUserDraft] = useState({ email: "", role: "worker", password: "" });
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");

  const [financeDraft, setFinanceDraft] = useState({
    type: "expense",
    amount: "",
    description: "",
    date: new Date().toISOString().split("T")[0],
    file: null
  });
  const [financeMessage, setFinanceMessage] = useState("");
  const [financeError, setFinanceError] = useState("");

  useEffect(() => {
    const unsubEggOrders = onSnapshot(
      query(collection(db, "eggOrders"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setEggOrders(data);
      }
    );

    const unsubLivestockOrders = onSnapshot(
      query(collection(db, "livestockOrders"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setLivestockOrders(data);
      }
    );

    const unsubEggTypes = onSnapshot(
      query(collection(db, "eggTypes"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setEggTypes(data);
      }
    );

    const unsubDelivery = onSnapshot(
      query(collection(db, "deliveryOptions"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setDeliveryOptions(data);
      }
    );

    const unsubLivestockDelivery = onSnapshot(
      query(collection(db, "livestockDeliveryOptions"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setLivestockDeliveryOptions(data);
      }
    );

    const unsubLivestockCategories = onSnapshot(
      query(collection(db, "livestockCategories"), orderBy("name", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setLivestockCategories(data);
      }
    );

    const unsubLivestockTypes = onSnapshot(
      query(collection(db, "livestockTypes"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setLivestockTypes(data);
      }
    );

    const unsubStockItems = onSnapshot(
      query(collection(db, "stockItems"), orderBy("name", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setStockItems(data);
      }
    );

    const unsubStockLogs = onSnapshot(
      query(collection(db, "stockLogs"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setStockLogs(data);
      }
    );

    const unsubStockUpdateLogs = onSnapshot(
      query(collection(db, "stockUpdateLogs"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setStockUpdateLogs(data);
      }
    );

    const unsubStockCategories = onSnapshot(
      query(collection(db, "stockCategories"), orderBy("name", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setStockCategories(data);
      }
    );

    const unsubUsers = onSnapshot(
      query(collection(db, "users"), orderBy("email", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setUsers(data);
      }
    );

    const unsubFinance = onSnapshot(
      query(collection(db, "financeEntries"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setFinanceEntries(data);
      }
    );

    return () => {
      unsubEggOrders();
      unsubLivestockOrders();
      unsubEggTypes();
      unsubDelivery();
      unsubLivestockDelivery();
      unsubLivestockCategories();
      unsubLivestockTypes();
      unsubStockItems();
      unsubStockLogs();
      unsubStockUpdateLogs();
      unsubStockCategories();
      unsubUsers();
      unsubFinance();
    };
  }, []);

  const deliveryLookup = useMemo(() => {
    const lookup = new Map();
    const options = deliveryOptions.length > 0 ? deliveryOptions : DEFAULT_DELIVERY_OPTIONS;
    options.forEach((option) => lookup.set(option.id, Number(option.cost ?? 0)));
    return lookup;
  }, [deliveryOptions]);

  const hydrateOrders = (orders, fallbackOptions) => {
    const fallbackLookup = new Map();
    fallbackOptions.forEach((option) => fallbackLookup.set(option.id, option.cost));

    return orders.map((order) => {
      const eggs = Array.isArray(order.eggs) ? order.eggs : [];
      const eggsTotal = eggs.reduce((sum, item) => {
        const price = item.specialPrice == null || item.specialPrice === 0 ? item.price : item.specialPrice;
        return sum + Number(price ?? 0) * Number(item.quantity ?? 0);
      }, 0);

      const deliveryCost =
        typeof order.deliveryCost === "number"
          ? Number(order.deliveryCost)
          : deliveryLookup.get(order.deliveryOptionId ?? "") ??
            fallbackLookup.get(order.deliveryOptionId ?? "") ??
            extractCost(order.deliveryOption);

      const totalCost = eggsTotal + deliveryCost;
      const createdAtDate = order.createdAt?.toDate
        ? order.createdAt.toDate()
        : order.createdAt?.seconds
          ? new Date(order.createdAt.seconds * 1000)
          : null;

      return {
        ...order,
        eggsTotal,
        deliveryCost,
        totalCost,
        orderNumber: order.orderNumber ?? "",
        orderStatus: order.orderStatus ?? "pending",
        trackingLink: order.trackingLink ?? "",
        paid: Boolean(order.paid),
        createdAtDate,
        eggSummary:
          eggs
            .filter((item) => (item.quantity ?? 0) > 0)
            .map((item) => `${item.label} x ${item.quantity}`)
            .join(", ") || "-"
      };
    });
  };

  const enrichedEggOrders = useMemo(
    () => hydrateOrders(eggOrders, DEFAULT_FORM_DELIVERY_OPTIONS),
    [eggOrders, deliveryLookup]
  );

  const enrichedLivestockOrders = useMemo(
    () => hydrateOrders(livestockOrders, DEFAULT_LIVESTOCK_DELIVERY_OPTIONS),
    [livestockOrders, deliveryLookup]
  );

  const resolvedEggDeliveryOptions =
    deliveryOptions.length > 0 ? deliveryOptions : DEFAULT_FORM_DELIVERY_OPTIONS;
  const resolvedLivestockDeliveryOptions =
    livestockDeliveryOptions.length > 0
      ? livestockDeliveryOptions
      : DEFAULT_LIVESTOCK_DELIVERY_OPTIONS;
  const resolvedEggTypes = eggTypes.length > 0 ? eggTypes : DEFAULT_EGG_TYPES;

  const applyOrderFilters = (orders) => {
    return orders
      .filter((order) => {
        if (statusFilter === "all") {
          if (
            order.orderStatus === "completed" ||
            order.orderStatus === "archived" ||
            order.orderStatus === "cancelled"
          ) {
            return false;
          }
        } else if (order.orderStatus !== statusFilter) {
          return false;
        }
        if (paidFilter === "paid" && !order.paid) return false;
        if (paidFilter === "unpaid" && order.paid) return false;
        if (!searchTerm.trim()) return true;
        const queryText = searchTerm.toLowerCase();
        return [
          order.name,
          order.surname,
          order.email,
          order.cellphone,
          order.deliveryOption,
          order.eggSummary
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(queryText);
      })
      .sort((a, b) => {
        switch (sortKey) {
          case "orderNumberAsc":
            return String(a.orderNumber).localeCompare(String(b.orderNumber));
          case "orderNumberDesc":
            return String(b.orderNumber).localeCompare(String(a.orderNumber));
          case "createdAsc":
            return (a.createdAtDate?.getTime() ?? 0) - (b.createdAtDate?.getTime() ?? 0);
          case "createdDesc":
            return (b.createdAtDate?.getTime() ?? 0) - (a.createdAtDate?.getTime() ?? 0);
          case "sendDateAsc":
            return String(a.sendDate ?? "").localeCompare(String(b.sendDate ?? ""));
          case "sendDateDesc":
            return String(b.sendDate ?? "").localeCompare(String(a.sendDate ?? ""));
          case "status":
            return String(a.orderStatus ?? "").localeCompare(String(b.orderStatus ?? ""));
          case "totalAsc":
            return (a.totalCost ?? 0) - (b.totalCost ?? 0);
          case "totalDesc":
            return (b.totalCost ?? 0) - (a.totalCost ?? 0);
          default:
            return 0;
        }
      });
  };

  const filteredEggOrders = useMemo(
    () => applyOrderFilters(enrichedEggOrders),
    [enrichedEggOrders, statusFilter, paidFilter, searchTerm, sortKey]
  );
  const filteredLivestockOrders = useMemo(
    () => applyOrderFilters(enrichedLivestockOrders),
    [enrichedLivestockOrders, statusFilter, paidFilter, searchTerm, sortKey]
  );

  useEffect(() => {
    if (!selectedOrder) return;
    const source =
      selectedOrderCollection === "livestockOrders"
        ? enrichedLivestockOrders
        : enrichedEggOrders;
    const updated = source.find((item) => item.id === selectedOrder.id);
    if (updated && updated !== selectedOrder) setSelectedOrder(updated);
  }, [selectedOrder, selectedOrderCollection, enrichedEggOrders, enrichedLivestockOrders]);

  const stockCategoryOptions = useMemo(() => {
    const options = stockCategories.map((category) => ({
      id: category.id,
      name: category.name ?? "Unnamed"
    }));
    return [{ id: "all", name: "All categories" }, ...options, { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL }];
  }, [stockCategories]);

  const filteredStockItems = useMemo(() => {
    const queryText = stockSearch.trim().toLowerCase();
    const filtered = stockItems.filter((item) => {
      const matchesCategory =
        stockCategoryFilter === "all" ||
        (stockCategoryFilter === UNCATEGORIZED_ID && !item.categoryId) ||
        item.categoryId === stockCategoryFilter;
      if (!matchesCategory) return false;
      if (!queryText) return true;
      return [item.name, item.category, item.subCategory, item.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    });

    return filtered.sort((a, b) => {
      switch (stockSort) {
        case "name_desc":
          return String(b.name ?? "").localeCompare(String(a.name ?? ""));
        case "quantity_asc":
          return Number(a.quantity ?? 0) - Number(b.quantity ?? 0);
        case "quantity_desc":
          return Number(b.quantity ?? 0) - Number(a.quantity ?? 0);
        case "threshold_asc":
          return Number(a.threshold ?? 0) - Number(b.threshold ?? 0);
        case "threshold_desc":
          return Number(b.threshold ?? 0) - Number(a.threshold ?? 0);
        case "name_asc":
        default:
          return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      }
    });
  }, [stockItems, stockSearch, stockCategoryFilter, stockSort]);

  const ordersSummary = useMemo(() => {
    const allOrders = [...enrichedEggOrders, ...enrichedLivestockOrders];
    const totalValue = allOrders.reduce((sum, order) => sum + (order.totalCost ?? 0), 0);
    return {
      totalOrders: allOrders.length,
      totalValue,
      paidCount: allOrders.filter((order) => order.paid).length
    };
  }, [enrichedEggOrders, enrichedLivestockOrders]);

  const financeSummary = useMemo(() => {
    return financeEntries.reduce(
      (totals, entry) => {
        const amount = Number(entry.amount ?? 0);
        if (entry.type === "income") totals.income += amount;
        else totals.expense += amount;
        return totals;
      },
      { income: 0, expense: 0 }
    );
  }, [financeEntries]);

  const handlePaidToggle = async (collectionName, order) => {
    try {
      await updateDoc(doc(db, collectionName, order.id), { paid: !order.paid });
    } catch (err) {
      console.error("paid toggle error", err);
    }
  };

  const handleOrderUpdate = async (collectionName, orderId, updates) => {
    try {
      await updateDoc(doc(db, collectionName, orderId), updates);
    } catch (err) {
      console.error("order update error", err);
    }
  };

  const handleOrderDelete = async (collectionName, order) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete order ${order.orderNumber || ""}?`)) return;
    try {
      await deleteDoc(doc(db, collectionName, order.id));
      setSelectedOrder(null);
    } catch (err) {
      console.error("order delete error", err);
    }
  };

  const handleAddEggType = async () => {
    setEggError("");
    setEggMessage("");
    if (!eggDraft.label.trim() || !eggDraft.price) {
      setEggError("Label and price are required.");
      return;
    }
    try {
      await addDoc(collection(db, "eggTypes"), {
        label: eggDraft.label.trim(),
        price: Number(eggDraft.price),
        specialPrice: eggDraft.specialPrice ? Number(eggDraft.specialPrice) : null,
        order: eggTypes.length + 1,
        available: true
      });
      setEggDraft({ label: "", price: "", specialPrice: "" });
      setEggMessage("Egg type added.");
    } catch (err) {
      console.error("add egg type error", err);
      setEggError("Unable to add egg type.");
    }
  };

  const handleToggleEggAvailability = async (item) => {
    setEggError("");
    setEggMessage("");
    const nextAvailable = item.available === false;
    try {
      await updateDoc(doc(db, "eggTypes", item.id), { available: nextAvailable });
      setEggMessage(
        nextAvailable ? "Egg type marked available." : "Egg type marked unavailable."
      );
    } catch (err) {
      console.error("toggle egg availability error", err);
      setEggError("Unable to update availability.");
    }
  };

  const handleSaveEggType = async (id) => {
    setEggError("");
    setEggMessage("");
    const update = eggEdits[id];
    if (!update) return;
    try {
      await updateDoc(doc(db, "eggTypes", id), {
        label: update.label,
        price: Number(update.price),
        specialPrice: update.specialPrice ? Number(update.specialPrice) : null
      });
      setEggMessage("Egg type saved.");
    } catch (err) {
      console.error("save egg type error", err);
      setEggError("Unable to save egg type.");
    }
  };

  const handleDeleteEggType = async (id) => {
    if (!window.confirm("Delete this egg type?")) return;
    try {
      await deleteDoc(doc(db, "eggTypes", id));
    } catch (err) {
      console.error("delete egg type error", err);
    }
  };

  const handleAddDeliveryOption = async (collectionName, draft, reset, setMessage, setError) => {
    setError("");
    setMessage("");
    if (!draft.label.trim() || draft.cost === "") {
      setError("Label and cost are required.");
      return;
    }
    try {
      await addDoc(collection(db, collectionName), {
        label: draft.label.trim(),
        cost: Number(draft.cost),
        order: Date.now()
      });
      reset({ label: "", cost: "" });
      setMessage("Delivery option added.");
    } catch (err) {
      console.error("add delivery option error", err);
      setError("Unable to add delivery option.");
    }
  };

  const handleSaveDeliveryOption = async (collectionName, id, edits, setMessage, setError) => {
    setError("");
    setMessage("");
    const update = edits[id];
    if (!update) return;
    try {
      await updateDoc(doc(db, collectionName, id), {
        label: update.label,
        cost: Number(update.cost)
      });
      setMessage("Delivery option saved.");
    } catch (err) {
      console.error("save delivery option error", err);
      setError("Unable to save delivery option.");
    }
  };

  const handleDeleteDeliveryOption = async (collectionName, id) => {
    if (!window.confirm("Delete this delivery option?")) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
    } catch (err) {
      console.error("delete delivery option error", err);
    }
  };

  const handleAddCategory = async () => {
    setCategoryError("");
    setCategoryMessage("");
    if (!categoryDraft.name.trim()) {
      setCategoryError("Category name is required.");
      return;
    }
    try {
      await addDoc(collection(db, "livestockCategories"), {
        name: categoryDraft.name.trim(),
        description: categoryDraft.description.trim()
      });
      setCategoryDraft({ name: "", description: "" });
      setCategoryMessage("Category added.");
    } catch (err) {
      console.error("add category error", err);
      setCategoryError("Unable to add category.");
    }
  };

  const handleSaveCategory = async (category) => {
    try {
      await updateDoc(doc(db, "livestockCategories", category.id), {
        name: category.name,
        description: category.description ?? ""
      });
      setCategoryMessage("Category updated.");
    } catch (err) {
      console.error("save category error", err);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!window.confirm(`Delete category ${category.name}?`)) return;
    try {
      await deleteDoc(doc(db, "livestockCategories", category.id));
    } catch (err) {
      console.error("delete category error", err);
    }
  };

  const handleAddLivestockType = async () => {
    setLivestockError("");
    setLivestockMessage("");
    if (!livestockDraft.label.trim() || !livestockDraft.price) {
      setLivestockError("Label and price are required.");
      return;
    }
    try {
      const category = livestockCategories.find((cat) => cat.id === livestockDraft.categoryId);
      await addDoc(collection(db, "livestockTypes"), {
        label: livestockDraft.label.trim(),
        price: Number(livestockDraft.price),
        specialPrice: livestockDraft.specialPrice ? Number(livestockDraft.specialPrice) : null,
        order: Date.now(),
        categoryId: livestockDraft.categoryId || "",
        categoryName: category?.name ?? ""
      });
      setLivestockDraft({ label: "", price: "", specialPrice: "", categoryId: "" });
      setLivestockMessage("Livestock item added.");
    } catch (err) {
      console.error("add livestock item error", err);
      setLivestockError("Unable to add livestock item.");
    }
  };

  const handleSaveLivestockType = async (id) => {
    const update = livestockEdits[id];
    if (!update) return;
    try {
      await updateDoc(doc(db, "livestockTypes", id), {
        label: update.label,
        price: Number(update.price),
        specialPrice: update.specialPrice ? Number(update.specialPrice) : null,
        categoryId: update.categoryId ?? "",
        categoryName:
          livestockCategories.find((cat) => cat.id === update.categoryId)?.name ?? ""
      });
      setLivestockMessage("Livestock item saved.");
    } catch (err) {
      console.error("save livestock item error", err);
      setLivestockError("Unable to save livestock item.");
    }
  };

  const handleDeleteLivestockType = async (id) => {
    if (!window.confirm("Delete this livestock item?")) return;
    try {
      await deleteDoc(doc(db, "livestockTypes", id));
    } catch (err) {
      console.error("delete livestock item error", err);
      setLivestockError("Unable to delete livestock item.");
    }
  };

  const handleUpdateStockItem = async (item, updates, logType = "stockLogs") => {
    const fromQty = Number(item.quantity ?? 0);
    const toQty = Number(updates.quantity ?? fromQty);
    const change = toQty - fromQty;

    try {
      await updateDoc(doc(db, "stockItems", item.id), {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy: user.email ?? ""
      });

    await addDoc(collection(db, logType), {
        itemId: item.id,
        name: item.name ?? "",
        summary: item.name ?? "",
        change,
        fromQty,
        toQty,
        notes: updates.notes ?? "",
        userEmail: user.email ?? "",
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("stock update error", err);
    }
  };

  const handleAddStockCategory = async () => {
    setStockCategoryError("");
    setStockCategoryMessage("");
    if (!stockCategoryDraft.name.trim()) {
      setStockCategoryError("Category name is required.");
      return;
    }
    try {
      await addDoc(collection(db, "stockCategories"), {
        name: stockCategoryDraft.name.trim()
      });
      setStockCategoryDraft({ name: "" });
      setStockCategoryMessage("Category added.");
    } catch (err) {
      console.error("add stock category error", err);
      setStockCategoryError("Unable to add category.");
    }
  };

  const handleDeleteStockCategory = async (category) => {
    if (!window.confirm(`Delete category ${category.name}? This also removes items.`)) return;
    try {
      const callable = httpsCallable(functions, "deleteCategoryWithItems");
      await callable({ categoryId: category.id });
    } catch (err) {
      console.warn("deleteCategoryWithItems failed, falling back", err);
      const itemsToDelete = stockItems.filter((item) => item.categoryId === category.id);
      await Promise.all(itemsToDelete.map((item) => deleteDoc(doc(db, "stockItems", item.id))));
      await deleteDoc(doc(db, "stockCategories", category.id));
    }
  };

  const handleAddStockItem = async () => {
    setStockItemError("");
    if (!stockItemDraft.name.trim()) {
      setStockItemError("Item name is required.");
      return;
    }
    try {
      const category = stockCategories.find((cat) => cat.id === stockItemDraft.categoryId);
      await addDoc(collection(db, "stockItems"), {
        name: stockItemDraft.name.trim(),
        categoryId: stockItemDraft.categoryId || "",
        category: category?.name ?? "",
        subCategory: stockItemDraft.subCategory.trim(),
        quantity: Number(stockItemDraft.quantity || 0),
        threshold: Number(stockItemDraft.threshold || 0),
        notes: stockItemDraft.notes.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user.email ?? ""
      });
      setStockItemDraft({
        name: "",
        categoryId: "",
        subCategory: "",
        quantity: "",
        threshold: "5",
        notes: ""
      });
    } catch (err) {
      console.error("add stock item error", err);
      setStockItemError("Unable to add stock item.");
    }
  };

  const handleCreateUser = async () => {
    setUserError("");
    setUserMessage("");
    if (!isAdmin) {
      setUserError("Only admins can manage users.");
      return;
    }
    if (!userDraft.email.trim()) {
      setUserError("Email is required.");
      return;
    }
    try {
      const callable = httpsCallable(functions, "createAuthUser");
      const result = await callable({
        email: userDraft.email.trim(),
        role: userDraft.role,
        password: userDraft.password.trim() || undefined
      });
      const tempPassword = result?.data?.temporaryPassword;
      setUserMessage(
        tempPassword
          ? `User created. Temporary password: ${tempPassword}`
          : "User created."
      );
      setUserDraft({ email: "", role: "worker", password: "" });
    } catch (err) {
      console.error("create user error", err);
      setUserError("Unable to create user.");
    }
  };

  const handleToggleUserStatus = async (targetUser, disabled) => {
    if (!isAdmin) return;
    if (targetUser.id === user.uid) {
      setUserError("You cannot disable your own account.");
      return;
    }
    try {
      const callable = httpsCallable(functions, "updateAuthUserStatus");
      await callable({ uid: targetUser.id, disabled });
      setUserMessage(`User ${disabled ? "disabled" : "enabled"}.`);
    } catch (err) {
      console.error("update user status error", err);
      setUserError("Unable to update account status.");
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!isAdmin) return;
    if (targetUser.id === user.uid) {
      setUserError("You cannot delete your own account.");
      return;
    }
    if (!window.confirm(`Delete account for ${targetUser.email}?`)) return;
    try {
      const callable = httpsCallable(functions, "deleteAuthUser");
      await callable({ uid: targetUser.id });
      setUserMessage("User deleted.");
    } catch (err) {
      console.error("delete user error", err);
      setUserError("Unable to delete account.");
    }
  };

  const handleAddFinance = async () => {
    setFinanceError("");
    setFinanceMessage("");
    if (!financeDraft.amount) {
      setFinanceError("Amount is required.");
      return;
    }

    let attachmentUrl = "";
    let attachmentName = "";

    try {
      if (financeDraft.file) {
        const fileRef = storageRef(
          storage,
          `finance/${Date.now()}_${financeDraft.file.name}`
        );
        await uploadBytes(fileRef, financeDraft.file);
        attachmentUrl = await getDownloadURL(fileRef);
        attachmentName = financeDraft.file.name;
      }

      await addDoc(collection(db, "financeEntries"), {
        type: financeDraft.type,
        amount: Number(financeDraft.amount),
        description: financeDraft.description.trim(),
        date: financeDraft.date,
        attachmentUrl,
        attachmentName,
        createdAt: serverTimestamp()
      });

      setFinanceDraft({
        type: "expense",
        amount: "",
        description: "",
        date: new Date().toISOString().split("T")[0],
        file: null
      });
      setFinanceMessage("Entry added.");
    } catch (err) {
      console.error("add finance error", err);
      setFinanceError("Unable to add finance entry.");
    }
  };

  const handleSendDispatchEmail = async (collectionName, order) => {
    try {
      const callable = httpsCallable(functions, "sendDispatchEmail");
      await callable({ collectionName, orderId: order.id });
    } catch (err) {
      console.error("send dispatch email error", err);
      throw err;
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const showOrderActionMessage = (message) => {
    setOrderActionMessage(message);
    window.setTimeout(() => setOrderActionMessage(""), 2500);
  };

  const getActiveFormLink = () => {
    const path = activeTab === "livestock_orders" ? "/livestock" : "/eggs";
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  };

  const handleCopyFormLink = async () => {
    const link = getActiveFormLink();
    try {
      await navigator.clipboard.writeText(link);
      showOrderActionMessage("Form link copied.");
    } catch (err) {
      console.warn("copy form link failed", err);
      window.prompt("Copy form link:", link);
    }
  };

  const handleShareFormLink = () => {
    const link = getActiveFormLink();
    const text = `Order form: ${link}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const activeOrders = activeTab === "livestock_orders" ? filteredLivestockOrders : filteredEggOrders;
  const activeOrderTitle =
    activeTab === "livestock_orders" ? "Live Livestock Orders" : "Live Egg Orders";
  const activeOrderCollection = activeTab === "livestock_orders" ? "livestockOrders" : "eggOrders";
  const activeItemLabel = activeTab === "livestock_orders" ? "Livestock" : "Eggs";
  const modalDeliveryOptions =
    selectedOrderCollection === "livestockOrders"
      ? resolvedLivestockDeliveryOptions
      : resolvedEggDeliveryOptions;
  const modalItemOptions =
    selectedOrderCollection === "livestockOrders" ? livestockTypes : resolvedEggTypes;
  const isOrdersActive = activeTab === "orders" || activeTab === "livestock_orders";
  const isTypesActive = activeTab === "eggs" || activeTab === "livestock_types";
  const canSeeTypes = isAdmin;
  const toggleMenu = (menuId) =>
    setOpenMenu((prev) => (prev === menuId ? null : menuId));

  const orderTabs = [
    { id: "orders", label: "Egg orders" },
    { id: "livestock_orders", label: "Livestock orders" }
  ];

  const typeTabs = [
    { id: "eggs", label: "Egg types", adminOnly: true },
    { id: "livestock_types", label: "Livestock types", adminOnly: true }
  ];

  const tabs = [
    { id: "delivery", label: "Delivery methods", adminOnly: true },
    { id: "livestock_delivery", label: "Livestock delivery", adminOnly: true },
    { id: "inventory", label: "Inventory" },
    { id: "stock_logs", label: "Stock logs" },
    { id: "stock_updates", label: "Stock updates" },
    { id: "users", label: "Users", adminOnly: true },
    { id: "finance", label: "Finance", adminOnly: true },
    { id: "reports", label: "Reports", adminOnly: true }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
            Admin dashboard
          </p>
          <h1 className="text-2xl font-bold text-brandGreen">Operations Center</h1>
          <p className={mutedText}>Signed in as {user.email}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
        >
          Sign out
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => toggleMenu("orders")}
            aria-haspopup="menu"
            aria-expanded={openMenu === "orders"}
            className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
              isOrdersActive
                ? "bg-brandGreen text-white"
                : "bg-white text-brandGreen border border-brandGreen/30"
            }`}
          >
            Orders ▾
          </button>
          {openMenu === "orders" ? (
            <div className="absolute left-0 z-20 mt-2 w-56 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl">
              {orderTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setOpenMenu(null);
                  }}
                  className={`w-full rounded-full px-3 py-2 text-left text-sm font-semibold transition ${
                    activeTab === tab.id
                      ? "bg-brandGreen text-white"
                      : "text-brandGreen hover:bg-brandBeige"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {canSeeTypes ? (
          <div className="relative" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => toggleMenu("types")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "types"}
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                isTypesActive
                  ? "bg-brandGreen text-white"
                  : "bg-white text-brandGreen border border-brandGreen/30"
              }`}
            >
              Types ▾
            </button>
            {openMenu === "types" ? (
              <div className="absolute left-0 z-20 mt-2 w-56 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl">
                {typeTabs
                  .filter((tab) => !tab.adminOnly || isAdmin)
                  .map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id);
                        setOpenMenu(null);
                      }}
                      className={`w-full rounded-full px-3 py-2 text-left text-sm font-semibold transition ${
                        activeTab === tab.id
                          ? "bg-brandGreen text-white"
                          : "text-brandGreen hover:bg-brandBeige"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tabs
          .filter((tab) => !tab.adminOnly || isAdmin)
          .map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                activeTab === tab.id
                  ? "bg-brandGreen text-white"
                  : "bg-white text-brandGreen border border-brandGreen/30"
              }`}
            >
              {tab.label}
            </button>
          ))}
      </div>

      {(activeTab === "orders" || activeTab === "livestock_orders") && (
        <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Admin dashboard
              </p>
              <h2 className="text-2xl font-bold text-brandGreen">{activeOrderTitle}</h2>
              <p className={mutedText}>Real-time feed and sorted by most recent.</p>
            </div>
            <div className="flex flex-col gap-2 text-sm text-brandGreen md:items-end">
              <div className="rounded-full bg-white/70 px-4 py-2 shadow-inner">
                Total orders: <span className="font-semibold">{activeOrders.length}</span>
              </div>
            </div>
          </div>

          <div className={panelClass}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyFormLink}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Copy form link
              </button>
              <button
                type="button"
                onClick={handleShareFormLink}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige"
              >
                Share form on WhatsApp
              </button>
              {orderActionMessage ? (
                <span className="text-xs font-semibold text-brandGreen/70">
                  {orderActionMessage}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-40"
                >
                  <option value="all">All</option>
                  {ORDER_STATUSES.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Paid
                </label>
                <select
                  value={paidFilter}
                  onChange={(event) => setPaidFilter(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-36"
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Sort
                </label>
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-44"
                >
                  <option value="orderNumberDesc">Order # (latest first)</option>
                  <option value="orderNumberAsc">Order # (oldest first)</option>
                  <option value="createdDesc">Created newest</option>
                  <option value="createdAsc">Oldest first</option>
                  <option value="sendDateAsc">Send date ascending</option>
                  <option value="sendDateDesc">Send date descending</option>
                  <option value="status">Status</option>
                  <option value="totalDesc">Total cost descending</option>
                  <option value="totalAsc">Total cost ascending</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2 md:w-72">
              <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Search (name, email, phone, delivery, items)
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="e.g. Runner, courier, 082..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-brandGreen/10 bg-white/70 p-4 text-center text-sm text-brandGreen/70 shadow-inner">
                No orders match your filters.
              </div>
            ) : (
              activeOrders.map((order) => (
                <div
                  key={order.id}
                  className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner"
                  onClick={() => {
                    setSelectedOrder(order);
                    setSelectedOrderCollection(activeOrderCollection);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-brandGreen/70">{formatDate(order.createdAtDate)}</p>
                      <p className="text-xs font-mono text-brandGreen">
                        {order.orderNumber || "-"}
                      </p>
                      <p className="font-semibold text-brandGreen">
                        {order.name} {order.surname}
                      </p>
                      <p className="text-xs text-brandGreen/70">
                        {[order.email, order.cellphone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                          STATUS_STYLES[order.orderStatus] || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {order.orderStatus}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedOrder(order);
                          setSelectedOrderCollection(activeOrderCollection);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brandGreen text-white shadow-sm transition hover:shadow-md"
                        aria-label="View order"
                      >
                        ...
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm text-brandGreen">
                    <p className="font-semibold">
                      Delivery: {order.deliveryOption ?? "-"}
                    </p>
                    <p>Send date: {order.sendDate ?? "-"}</p>
                    <p className="font-semibold">Total: {formatCurrency(order.totalCost)}</p>
                    <p>
                      {activeItemLabel}: {order.eggSummary || "-"}
                    </p>
                    <p>
                      <span className="font-semibold">Paid:</span>{" "}
                      {order.paid ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block">
            <div className="overflow-x-auto rounded-2xl border border-brandGreen/10">
              <table className="w-full min-w-[1500px] text-left text-sm text-brandGreen">
                <thead className="bg-brandGreen text-white">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Order #</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Cellphone</th>
                    <th className="px-4 py-3 font-semibold">Delivery</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Send date</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Paid</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-center text-brandGreen/70">
                        No orders match your filters.
                      </td>
                    </tr>
                  )}
                  {activeOrders.map((order, index) => {
                    const rowClass = index % 2 === 0 ? "bg-white" : "bg-brandBeige/60";
                    const internalNote =
                      typeof order.internalNote === "string" ? order.internalNote.trim() : "";
                    const noteTitle = internalNote
                      ? `Internal note: ${internalNote.replace(/\s+/g, " ")}`
                      : "";
                    return (
                      <tr
                        key={order.id}
                        className={`${rowClass} transition cursor-pointer`}
                        onClick={() => {
                          setSelectedOrder(order);
                          setSelectedOrderCollection(activeOrderCollection);
                        }}
                      >
                        <td className="px-4 py-3 align-top">
                          {formatDate(order.createdAtDate)}
                        </td>
                        <td className="px-4 py-3 align-top font-mono">
                          {order.orderNumber || "-"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">
                            {order.name} {order.surname}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <a
                            href={`mailto:${order.email}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-brandGreen underline decoration-brandGreen/50 decoration-1 underline-offset-2"
                          >
                            {order.email}
                          </a>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <a
                            href={`tel:${order.cellphone}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-brandGreen"
                          >
                            {order.cellphone}
                          </a>
                        </td>
                        <td className="px-4 py-3 align-top">{order.deliveryOption ?? "-"}</td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                              STATUS_STYLES[order.orderStatus] || "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {order.orderStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">{order.sendDate ?? "-"}</td>
                        <td className="px-4 py-3 align-top font-semibold">
                          {formatCurrency(order.totalCost)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              order.paid
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : "bg-amber-100 text-amber-800 border border-amber-200"
                            }`}
                          >
                            {order.paid ? "Paid" : "Unpaid"}
                          </span>
                        </td>
                        <td className="relative px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-2">
                            {internalNote ? (
                              <button
                                type="button"
                                title={noteTitle}
                                aria-label="View internal note"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedOrder(order);
                                  setSelectedOrderCollection(activeOrderCollection);
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-brandGreen/30 bg-white text-brandGreen shadow-sm transition hover:bg-brandBeige"
                              >
                                i
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedOrder(order);
                                setSelectedOrderCollection(activeOrderCollection);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brandGreen text-white shadow-sm transition hover:shadow-md"
                              aria-label="View order"
                            >
                              ...
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "eggs" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Egg types
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Manage breeds & prices</h2>
              <p className={mutedText}>Add new breeds or update pricing/specials.</p>
            </div>
            {eggMessage ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {eggMessage}
              </span>
            ) : null}
          </div>

          {eggError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {eggError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              type="text"
              value={eggDraft.label}
              onChange={(event) => setEggDraft((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="e.g. New Breed"
              className={inputClass}
            />
            <input
              type="number"
              value={eggDraft.price}
              onChange={(event) => setEggDraft((prev) => ({ ...prev, price: event.target.value }))}
              placeholder="Price"
              className={inputClass}
            />
            <input
              type="number"
              value={eggDraft.specialPrice}
              onChange={(event) =>
                setEggDraft((prev) => ({ ...prev, specialPrice: event.target.value }))
              }
              placeholder="Special price (optional)"
              className={inputClass}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleAddEggType}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Add egg type
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {eggTypes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                No egg types found. Add one above to populate the order form.
              </div>
            ) : (
              eggTypes.map((item) => {
                const edit = eggEdits[item.id] ?? {
                  label: item.label ?? "",
                  price: item.price ?? 0,
                  specialPrice: item.specialPrice ?? ""
                };
                const isAvailable = item.available !== false;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm ${
                      isAvailable ? "" : "opacity-70"
                    }`}
                  >
                    <div className="grid gap-2 md:grid-cols-4">
                      <input
                        type="text"
                        className={inputClass}
                        value={edit.label}
                        onChange={(event) =>
                          setEggEdits((prev) => ({
                            ...prev,
                            [item.id]: { ...edit, label: event.target.value }
                          }))
                        }
                      />
                      <input
                        type="number"
                        className={inputClass}
                        value={edit.price}
                        onChange={(event) =>
                          setEggEdits((prev) => ({
                            ...prev,
                            [item.id]: { ...edit, price: event.target.value }
                          }))
                        }
                      />
                      <input
                        type="number"
                        className={inputClass}
                        value={edit.specialPrice}
                        onChange={(event) =>
                          setEggEdits((prev) => ({
                            ...prev,
                            [item.id]: { ...edit, specialPrice: event.target.value }
                          }))
                        }
                        placeholder="Special price"
                      />
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : "bg-amber-100 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {isAvailable ? "Available" : "Unavailable"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleSaveEggType(item.id)}
                          className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEggAvailability(item)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            isAvailable
                              ? "border-amber-300 text-amber-800 hover:bg-amber-50"
                              : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                          }`}
                        >
                          {isAvailable ? "Mark unavailable" : "Mark available"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEggType(item.id)}
                          className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "delivery" && (
        <DeliveryOptionsPanel
          title="Delivery methods"
          description="Manage delivery options for egg orders."
          options={deliveryOptions.length > 0 ? deliveryOptions : DEFAULT_DELIVERY_OPTIONS}
          draft={deliveryDraft}
          edits={deliveryEdits}
          setDraft={setDeliveryDraft}
          setEdits={setDeliveryEdits}
          message={deliveryMessage}
          error={deliveryError}
          onAdd={() =>
            handleAddDeliveryOption(
              "deliveryOptions",
              deliveryDraft,
              setDeliveryDraft,
              setDeliveryMessage,
              setDeliveryError
            )
          }
          onSave={(id) =>
            handleSaveDeliveryOption(
              "deliveryOptions",
              id,
              deliveryEdits,
              setDeliveryMessage,
              setDeliveryError
            )
          }
          onDelete={(id) => handleDeleteDeliveryOption("deliveryOptions", id)}
        />
      )}

      {activeTab === "livestock_delivery" && (
        <DeliveryOptionsPanel
          title="Livestock delivery methods"
          description="Manage delivery options for livestock orders."
          options={
            livestockDeliveryOptions.length > 0
              ? livestockDeliveryOptions
              : DEFAULT_LIVESTOCK_DELIVERY_OPTIONS
          }
          draft={livestockDeliveryDraft}
          edits={livestockDeliveryEdits}
          setDraft={setLivestockDeliveryDraft}
          setEdits={setLivestockDeliveryEdits}
          message={livestockDeliveryMessage}
          error={livestockDeliveryError}
          onAdd={() =>
            handleAddDeliveryOption(
              "livestockDeliveryOptions",
              livestockDeliveryDraft,
              setLivestockDeliveryDraft,
              setLivestockDeliveryMessage,
              setLivestockDeliveryError
            )
          }
          onSave={(id) =>
            handleSaveDeliveryOption(
              "livestockDeliveryOptions",
              id,
              livestockDeliveryEdits,
              setLivestockDeliveryMessage,
              setLivestockDeliveryError
            )
          }
          onDelete={(id) => handleDeleteDeliveryOption("livestockDeliveryOptions", id)}
        />
      )}

      {activeTab === "livestock_types" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Livestock types
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Categories & items</h2>
              <p className={mutedText}>
                Add categories and items under them. These feed the livestock order form.
              </p>
            </div>
            {categoryMessage ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {categoryMessage}
              </span>
            ) : null}
          </div>

          {categoryError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {categoryError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_3fr]">
            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">Add category</h3>
              <div className="grid gap-2">
                <input
                  type="text"
                  value={categoryDraft.name}
                  onChange={(event) =>
                    setCategoryDraft((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="e.g. Adult Chickens"
                  className={inputClass}
                />
                <textarea
                  value={categoryDraft.description}
                  onChange={(event) =>
                    setCategoryDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Description (optional)"
                  className={inputClass}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {livestockCategories.map((category) => (
                  <div key={category.id} className="space-y-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2">
                    <input
                      type="text"
                      value={category.name}
                      onChange={(event) =>
                        setLivestockCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, name: event.target.value }
                              : item
                          )
                        )
                      }
                      className={inputClass}
                    />
                    <textarea
                      value={category.description ?? ""}
                      onChange={(event) =>
                        setLivestockCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, description: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Description (optional)"
                      className={inputClass}
                    />
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => handleSaveCategory(category)}
                        className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category)}
                        className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {livestockCategories.length === 0 ? (
                  <p className={mutedText}>No categories yet.</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">Add livestock item</h3>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="text"
                  value={livestockDraft.label}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({ ...prev, label: event.target.value }))
                  }
                  placeholder="e.g. Bantam"
                  className={inputClass}
                />
                <select
                  value={livestockDraft.categoryId}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({ ...prev, categoryId: event.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Select category</option>
                  {livestockCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={livestockDraft.price}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({ ...prev, price: event.target.value }))
                  }
                  placeholder="Price"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={livestockDraft.specialPrice}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({ ...prev, specialPrice: event.target.value }))
                  }
                  placeholder="Special price (optional)"
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddLivestockType}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Add item
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-brandGreen/15 bg-white p-4 shadow-inner">
            <h3 className="text-sm font-semibold text-brandGreen">Existing items</h3>
            {livestockTypes.length === 0 ? (
              <p className={mutedText}>No livestock items yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {livestockCategories.map((category) => {
                  const items = livestockTypes.filter(
                    (item) => item.categoryId === category.id
                  );
                  return (
                    <div
                      key={category.id}
                      className="space-y-2 rounded-lg border border-brandGreen/15 bg-brandBeige/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-brandGreen">{category.name}</p>
                        <span className="text-xs text-brandGreen/60">
                          {items.length} item{items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <p className={mutedText}>No items in this category.</p>
                      ) : (
                        items.map((item) => {
                          const edit = livestockEdits[item.id] ?? {
                            label: item.label ?? "",
                            price: item.price ?? 0,
                            specialPrice: item.specialPrice ?? "",
                            categoryId: item.categoryId ?? ""
                          };
                          return (
                            <div
                              key={item.id}
                              className="rounded-lg border border-brandGreen/15 bg-white px-3 py-2 shadow-sm"
                            >
                              <div className="grid gap-2 md:grid-cols-2">
                                <input
                                  type="text"
                                  value={edit.label}
                                  onChange={(event) =>
                                    setLivestockEdits((prev) => ({
                                      ...prev,
                                      [item.id]: { ...edit, label: event.target.value }
                                    }))
                                  }
                                  className={inputClass}
                                />
                                <select
                                  value={edit.categoryId}
                                  onChange={(event) =>
                                    setLivestockEdits((prev) => ({
                                      ...prev,
                                      [item.id]: { ...edit, categoryId: event.target.value }
                                    }))
                                  }
                                  className={inputClass}
                                >
                                  <option value="">Select category</option>
                                  {livestockCategories.map((categoryOption) => (
                                    <option key={categoryOption.id} value={categoryOption.id}>
                                      {categoryOption.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  value={edit.price}
                                  onChange={(event) =>
                                    setLivestockEdits((prev) => ({
                                      ...prev,
                                      [item.id]: { ...edit, price: event.target.value }
                                    }))
                                  }
                                  className={inputClass}
                                />
                                <input
                                  type="number"
                                  value={edit.specialPrice}
                                  onChange={(event) =>
                                    setLivestockEdits((prev) => ({
                                      ...prev,
                                      [item.id]: { ...edit, specialPrice: event.target.value }
                                    }))
                                  }
                                  className={inputClass}
                                  placeholder="Special price"
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveLivestockType(item.id)}
                                  className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLivestockType(item.id)}
                                  className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "inventory" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Inventory
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Stock items</h2>
              <p className={mutedText}>
                Track quantities, thresholds, and notes. Admins can add items; workers can update
                quantities and notes.
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              type="text"
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
              placeholder="Search inventory"
              className={inputClass}
            />
            <select
              value={stockCategoryFilter}
              onChange={(event) => setStockCategoryFilter(event.target.value)}
              className={inputClass}
            >
              {stockCategoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <select
              value={stockSort}
              onChange={(event) => setStockSort(event.target.value)}
              className={inputClass}
            >
              {INVENTORY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {stockItemError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stockItemError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">Add category</h3>
              <input
                type="text"
                value={stockCategoryDraft.name}
                onChange={(event) =>
                  setStockCategoryDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="e.g. Feed"
                className={inputClass}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddStockCategory}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Add category
                </button>
              </div>
              {stockCategoryError ? (
                <p className="text-xs text-red-700">{stockCategoryError}</p>
              ) : null}
              {stockCategoryMessage ? (
                <p className="text-xs text-emerald-700">{stockCategoryMessage}</p>
              ) : null}
              <div className="space-y-2">
                {stockCategories.map((category) => (
                  <div key={category.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                    <span className="text-sm font-semibold text-brandGreen">
                      {category.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteStockCategory(category)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">Add stock item</h3>
              <div className="grid gap-2">
                <input
                  type="text"
                  value={stockItemDraft.name}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Item name"
                  className={inputClass}
                />
                <select
                  value={stockItemDraft.categoryId}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({ ...prev, categoryId: event.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Select category</option>
                  {stockCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={stockItemDraft.subCategory}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({ ...prev, subCategory: event.target.value }))
                  }
                  placeholder="Subcategory (optional)"
                  className={inputClass}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    type="number"
                    value={stockItemDraft.quantity}
                    onChange={(event) =>
                      setStockItemDraft((prev) => ({ ...prev, quantity: event.target.value }))
                    }
                    placeholder="Quantity"
                    className={inputClass}
                  />
                  <input
                    type="number"
                    value={stockItemDraft.threshold}
                    onChange={(event) =>
                      setStockItemDraft((prev) => ({ ...prev, threshold: event.target.value }))
                    }
                    placeholder="Threshold"
                    className={inputClass}
                  />
                </div>
                <textarea
                  value={stockItemDraft.notes}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="Notes"
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddStockItem}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Add item
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {filteredStockItems.map((item) => (
              <div key={item.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-brandGreen">{item.name}</p>
                    <p className="text-xs text-brandGreen/60">
                      {item.category || UNCATEGORIZED_LABEL}
                      {item.subCategory ? ` - ${item.subCategory}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      className="w-24 rounded-lg border border-brandGreen/30 bg-brandCream px-2 py-1 text-right text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                      value={item.quantity ?? 0}
                      onChange={(event) =>
                        setStockItems((prev) =>
                          prev.map((current) =>
                            current.id === item.id
                              ? { ...current, quantity: Number(event.target.value) }
                              : current
                          )
                        )
                      }
                    />
                    <input
                      type="text"
                      className="w-48 rounded-lg border border-brandGreen/30 bg-brandCream px-2 py-1 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                      value={item.notes ?? ""}
                      onChange={(event) =>
                        setStockItems((prev) =>
                          prev.map((current) =>
                            current.id === item.id
                              ? { ...current, notes: event.target.value }
                              : current
                          )
                        )
                      }
                      placeholder="Notes"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateStockItem(item, {
                          quantity: item.quantity ?? 0,
                          notes: item.notes ?? ""
                        })
                      }
                      className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredStockItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                No inventory items found.
              </div>
            ) : null}
          </div>
        </div>
      )}

      {activeTab === "stock_logs" && (
        <div className={panelClass}>
          <h2 className="text-xl font-bold text-brandGreen">Stock logs</h2>
          <p className={mutedText}>Recent inventory adjustments.</p>
          <div className="mt-4 space-y-2">
            {stockLogs.length === 0 ? (
              <p className={mutedText}>No stock logs yet.</p>
            ) : (
              stockLogs.map((log) => (
                <div key={log.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        {formatDate(log.createdAt)}
                      </p>
                      <p className="font-semibold text-brandGreen">{log.summary || log.name}</p>
                      <p className="text-sm text-brandGreen/70">{log.notes}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-brandGreen">
                        {log.change >= 0 ? "+" : ""}
                        {log.change}
                      </p>
                      <p className="text-xs text-brandGreen/60">
                        {log.fromQty} - {log.toQty}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "stock_updates" && (
        <div className={panelClass}>
          <h2 className="text-xl font-bold text-brandGreen">Stock updates</h2>
          <p className={mutedText}>
            Submit quick stock updates. Each update logs the change and updates inventory.
          </p>
          <div className="mt-4 space-y-3">
            {stockItems.length === 0 ? (
              <p className={mutedText}>No stock items to update.</p>
            ) : (
              stockItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-brandGreen">{item.name}</p>
                      <p className="text-xs text-brandGreen/60">
                        Current qty: {item.quantity ?? 0}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="number"
                        className="w-24 rounded-lg border border-brandGreen/30 bg-brandCream px-2 py-1 text-right text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                        value={item.quantity ?? 0}
                        onChange={(event) =>
                          setStockItems((prev) =>
                            prev.map((current) =>
                              current.id === item.id
                                ? { ...current, quantity: Number(event.target.value) }
                                : current
                            )
                          )
                        }
                      />
                      <input
                        type="text"
                        className="w-48 rounded-lg border border-brandGreen/30 bg-brandCream px-2 py-1 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                        value={item.notes ?? ""}
                        onChange={(event) =>
                          setStockItems((prev) =>
                            prev.map((current) =>
                              current.id === item.id
                                ? { ...current, notes: event.target.value }
                                : current
                            )
                          )
                        }
                        placeholder="Notes"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateStockItem(
                            item,
                            { quantity: item.quantity ?? 0, notes: item.notes ?? "" },
                            "stockUpdateLogs"
                          )
                        }
                        className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                      >
                        Submit update
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "users" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Users
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Manage accounts</h2>
              <p className={mutedText}>Create, disable, or delete users.</p>
            </div>
            {userMessage ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {userMessage}
              </span>
            ) : null}
          </div>
          {userError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {userError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              type="email"
              className={inputClass}
              value={userDraft.email}
              onChange={(event) => setUserDraft((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="Email"
            />
            <select
              className={inputClass}
              value={userDraft.role}
              onChange={(event) => setUserDraft((prev) => ({ ...prev, role: event.target.value }))}
            >
              <option value="worker">Worker</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            <input
              type="password"
              className={inputClass}
              value={userDraft.password}
              onChange={(event) =>
                setUserDraft((prev) => ({ ...prev, password: event.target.value }))
              }
              placeholder="Temporary password (optional)"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleCreateUser}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Create user
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {users.map((account) => (
              <div key={account.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-brandGreen">{account.email}</p>
                    <p className="text-xs text-brandGreen/60">Role: {account.role ?? "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleUserStatus(account, !account.disabled)}
                      className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                    >
                      {account.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(account)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "finance" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Finance
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Income & expenses</h2>
              <p className={mutedText}>Track payments, expenses, and attachments.</p>
            </div>
            {financeMessage ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {financeMessage}
              </span>
            ) : null}
          </div>

          {financeError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {financeError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <select
              className={inputClass}
              value={financeDraft.type}
              onChange={(event) =>
                setFinanceDraft((prev) => ({ ...prev, type: event.target.value }))
              }
            >
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <input
              type="number"
              className={inputClass}
              value={financeDraft.amount}
              onChange={(event) =>
                setFinanceDraft((prev) => ({ ...prev, amount: event.target.value }))
              }
              placeholder="Amount"
            />
            <input
              type="date"
              className={inputClass}
              value={financeDraft.date}
              onChange={(event) =>
                setFinanceDraft((prev) => ({ ...prev, date: event.target.value }))
              }
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              type="text"
              className={inputClass}
              value={financeDraft.description}
              onChange={(event) =>
                setFinanceDraft((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Description"
            />
            <input
              type="file"
              className={inputClass}
              onChange={(event) =>
                setFinanceDraft((prev) => ({ ...prev, file: event.target.files?.[0] ?? null }))
              }
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleAddFinance}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Add entry
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {financeEntries.length === 0 ? (
              <p className={mutedText}>No finance entries yet.</p>
            ) : (
              financeEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        {entry.type === "income" ? "Income" : "Expense"} - {entry.date ?? "-"}
                      </p>
                      <p className="text-sm text-brandGreen">{entry.description}</p>
                    </div>
                    <span
                      className={`text-lg font-semibold ${
                        entry.type === "income" ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      R{Number(entry.amount ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {entry.attachmentUrl ? (
                    <a
                      href={entry.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-brandGreen underline decoration-brandGreen/40 underline-offset-4"
                    >
                      {entry.attachmentName ?? "View attachment"}
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "reports" && (
        <div className={panelClass}>
          <h2 className="text-xl font-bold text-brandGreen">Reports</h2>
          <p className={mutedText}>Quick snapshots of orders, finance, and inventory.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
                Total orders
              </p>
              <p className="text-2xl font-bold text-brandGreen">{ordersSummary.totalOrders}</p>
            </div>
            <div className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
                Orders value
              </p>
              <p className="text-2xl font-bold text-brandGreen">
                R{ordersSummary.totalValue.toFixed(2)}
              </p>
            </div>
            <div className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
                Paid orders
              </p>
              <p className="text-2xl font-bold text-brandGreen">{ordersSummary.paidCount}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
                Finance summary
              </p>
              <p className="text-sm text-brandGreen">Income: R{financeSummary.income.toFixed(2)}</p>
              <p className="text-sm text-brandGreen">Expense: R{financeSummary.expense.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
                Inventory items
              </p>
              <p className="text-sm text-brandGreen">Total items: {stockItems.length}</p>
            </div>
          </div>
        </div>
      )}

      {selectedOrder ? (
        <OrderDetailModal
          order={selectedOrder}
          collectionName={selectedOrderCollection}
          deliveryOptions={modalDeliveryOptions}
          itemOptions={modalItemOptions}
          onPaidToggle={(order) => handlePaidToggle(selectedOrderCollection, order)}
          onSendDispatchEmail={(order) =>
            handleSendDispatchEmail(selectedOrderCollection, order)
          }
          onClose={() => setSelectedOrder(null)}
          onUpdate={(updates) =>
            handleOrderUpdate(selectedOrderCollection, selectedOrder.id, updates)
          }
          onDelete={() => handleOrderDelete(selectedOrderCollection, selectedOrder)}
        />
      ) : null}
    </div>
  );
}

function DeliveryOptionsPanel({
  title,
  description,
  options,
  draft,
  edits,
  setDraft,
  setEdits,
  message,
  error,
  onAdd,
  onSave,
  onDelete
}) {
  return (
    <div className={panelClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
            Delivery
          </p>
          <h2 className="text-xl font-bold text-brandGreen">{title}</h2>
          <p className={mutedText}>{description}</p>
        </div>
        {message ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {message}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          type="text"
          value={draft.label}
          onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
          placeholder="Label"
          className={inputClass}
        />
        <input
          type="number"
          value={draft.cost}
          onChange={(event) => setDraft((prev) => ({ ...prev, cost: event.target.value }))}
          placeholder="Cost"
          className={inputClass}
        />
        <div className="flex items-end justify-end">
          <button
            type="button"
            onClick={onAdd}
            className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
          >
            Add option
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
            No delivery options found.
          </div>
        ) : (
          options.map((option) => {
            const edit = edits[option.id] ?? {
              label: option.label ?? "",
              cost: option.cost ?? 0
            };
            return (
              <div key={option.id} className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm">
                <div className="grid gap-2 md:grid-cols-3">
                  <input
                    type="text"
                    className={inputClass}
                    value={edit.label}
                    onChange={(event) =>
                      setEdits((prev) => ({
                        ...prev,
                        [option.id]: { ...edit, label: event.target.value }
                      }))
                    }
                  />
                  <input
                    type="number"
                    className={inputClass}
                    value={edit.cost}
                    onChange={(event) =>
                      setEdits((prev) => ({
                        ...prev,
                        [option.id]: { ...edit, cost: event.target.value }
                      }))
                    }
                  />
                  <div className="flex gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => onSave(option.id)}
                      className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(option.id)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function OrderDetailModal({
  order,
  collectionName,
  deliveryOptions = [],
  itemOptions = [],
  onClose,
  onUpdate,
  onDelete,
  onPaidToggle,
  onSendDispatchEmail
}) {
  const [draft, setDraft] = useState({
    orderStatus: order.orderStatus ?? "pending",
    deliveryOptionId: order.deliveryOptionId ?? "",
    sendDate: order.sendDate ?? "",
    trackingLink: order.trackingLink ?? "",
    notes: order.notes ?? "",
    internalNote: order.internalNote ?? ""
  });
  const [lineItems, setLineItems] = useState([]);
  const [copyNotice, setCopyNotice] = useState("");
  const [internalNoteMessage, setInternalNoteMessage] = useState("");
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [dispatchSending, setDispatchSending] = useState(false);
  const [uploadingKey, setUploadingKey] = useState("");

  const isLivestock = collectionName === "livestockOrders";
  const itemLabelSingular = isLivestock ? "livestock" : "egg";
  const breakdownTitle = isLivestock ? "Livestock breakdown" : "Egg breakdown";

  useEffect(() => {
    setDraft({
      orderStatus: order.orderStatus ?? "pending",
      deliveryOptionId: order.deliveryOptionId ?? "",
      sendDate: order.sendDate ?? "",
      trackingLink: order.trackingLink ?? "",
      notes: order.notes ?? "",
      internalNote: order.internalNote ?? ""
    });
    const baseLines = Array.isArray(order.eggs)
      ? order.eggs.map((item) => ({
          lineId: createLineId(),
          itemId: item.id ?? "",
          label: item.label ?? "",
          price: Number(item.price ?? 0),
          specialPrice: item.specialPrice ?? null,
          quantity: item.quantity ?? 0
        }))
      : [];
    if (baseLines.length === 0) {
      const fallback = itemOptions[0];
      baseLines.push({
        lineId: createLineId(),
        itemId: fallback?.id ?? "",
        label: fallback?.label ?? "",
        price: Number(fallback?.price ?? 0),
        specialPrice: fallback?.specialPrice ?? null,
        quantity: 0
      });
    }
    setLineItems(baseLines);
    setCopyNotice("");
    setDispatchMessage("");
    setInternalNoteMessage("");
    setTrackingMessage("");
  }, [order]);

  const eggsTotal =
    typeof order.eggsTotal === "number"
      ? order.eggsTotal
      : Array.isArray(order.eggs)
        ? order.eggs.reduce((sum, item) => {
            const price =
              item.specialPrice === null || item.specialPrice === undefined || item.specialPrice === 0
                ? item.price
                : item.specialPrice;
            return sum + Number(price ?? 0) * Number(item.quantity ?? 0);
          }, 0)
        : 0;

  const deliveryCost =
    typeof order.deliveryCost === "number"
      ? order.deliveryCost
      : deliveryOptions.find((option) => option.id === order.deliveryOptionId)?.cost ??
        extractCost(order.deliveryOption);

  const totalCost =
    typeof order.totalCost === "number" ? order.totalCost : Number(eggsTotal) + Number(deliveryCost);

  const orderFullName = [order.name, order.surname].filter(Boolean).join(" ").trim();
  const contactLine = [order.email, order.cellphone].filter(Boolean).join(" · ");
  const addressText = order.address?.trim() || "No address provided.";

  const selectClass =
    "w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";

  const handleCopy = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label} copied.`);
    } catch (err) {
      console.warn("copy failed", err);
      setCopyNotice("Copy failed.");
    }
    setTimeout(() => setCopyNotice(""), 2000);
  };

  const handleStatusChange = async (value) => {
    setDraft((prev) => ({ ...prev, orderStatus: value }));
    try {
      await onUpdate({ orderStatus: value });
    } catch (err) {
      console.error("order status update error", err);
    }
  };

  const handleDeliveryChange = async (value) => {
    setDraft((prev) => ({ ...prev, deliveryOptionId: value }));
    const selected = deliveryOptions.find((option) => option.id === value);
    if (!selected) return;
    try {
      await onUpdate({
        deliveryOptionId: value,
        deliveryOption: selected.label ?? "",
        deliveryCost: Number(selected.cost ?? 0)
      });
    } catch (err) {
      console.error("delivery update error", err);
    }
  };

  const handleSendDateChange = async (value) => {
    setDraft((prev) => ({ ...prev, sendDate: value }));
    try {
      await onUpdate({ sendDate: value });
    } catch (err) {
      console.error("send date update error", err);
    }
  };

  const handleInternalNoteSave = async () => {
    setInternalNoteSaving(true);
    setInternalNoteMessage("");
    try {
      await onUpdate({ internalNote: draft.internalNote });
      setInternalNoteMessage("Internal note saved.");
    } catch (err) {
      console.error("internal note update error", err);
      setInternalNoteMessage("Unable to save internal note.");
    } finally {
      setInternalNoteSaving(false);
    }
  };

  const handleTrackingSave = async () => {
    setTrackingSaving(true);
    setTrackingMessage("");
    try {
      await onUpdate({ trackingLink: draft.trackingLink.trim() });
      setTrackingMessage("Tracking link saved.");
    } catch (err) {
      console.error("tracking link update error", err);
      setTrackingMessage("Unable to save tracking link.");
    } finally {
      setTrackingSaving(false);
    }
  };

  const handleLineChange = (lineId, updates) => {
    setLineItems((prev) =>
      prev.map((line) => (line.lineId === lineId ? { ...line, ...updates } : line))
    );
  };

  const handleSelectItem = (lineId, value) => {
    const selected = itemOptions.find((item) => item.id === value);
    handleLineChange(lineId, {
      itemId: value,
      label: selected?.label ?? "",
      price: Number(selected?.price ?? 0),
      specialPrice: selected?.specialPrice ?? null
    });
  };

  const handleAddLine = () => {
    const fallback = itemOptions[0];
    setLineItems((prev) => [
      ...prev,
      {
        lineId: createLineId(),
        itemId: fallback?.id ?? "",
        label: fallback?.label ?? "",
        price: Number(fallback?.price ?? 0),
        specialPrice: fallback?.specialPrice ?? null,
        quantity: 0
      }
    ]);
  };

  const handleRemoveLine = (lineId) => {
    setLineItems((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  const handleUpdateLines = async () => {
    const nextEggs = lineItems
      .filter((line) => Number(line.quantity ?? 0) > 0 && (line.itemId || line.label))
      .map((line) => ({
        id: line.itemId,
        label: line.label,
        quantity: Number(line.quantity ?? 0),
        price: Number(line.price ?? 0),
        specialPrice: line.specialPrice === "" ? null : line.specialPrice ?? null
      }));
    try {
      await onUpdate({ eggs: nextEggs });
    } catch (err) {
      console.error("egg breakdown update error", err);
    }
  };

  const handleAttachmentUpload = async (attachment, file) => {
    if (!file) return;
    setUploadingKey(attachment.key);
    try {
      const fileRef = storageRef(
        storage,
        `orders/${collectionName}/${order.id}/${attachment.key}_${Date.now()}_${file.name}`
      );
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await onUpdate({
        [attachment.urlField]: url,
        [attachment.nameField]: file.name
      });
    } catch (err) {
      console.error("attachment upload error", err);
    } finally {
      setUploadingKey("");
    }
  };

  const handleDispatchEmail = async () => {
    setDispatchSending(true);
    setDispatchMessage("");
    try {
      await onSendDispatchEmail(order);
      setDispatchMessage("Dispatch email sent.");
    } catch (err) {
      setDispatchMessage("Unable to send dispatch email.");
    } finally {
      setDispatchSending(false);
    }
  };

  const canSendDispatch = Boolean(order.email) && Boolean(draft.sendDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
              Order details
            </p>
            <h3 className="text-2xl font-bold text-brandGreen">
              {orderFullName || "Customer"}
            </h3>
            <p className="text-sm font-mono text-brandGreen">{order.orderNumber || "-"}</p>
            <p className="text-brandGreen/70">{contactLine || "-"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPaidToggle(order)}
              className="rounded-full border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              {order.paid ? "Mark unpaid" : "Mark paid"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-brandGreen px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Close
            </button>
          </div>
        </div>

        {copyNotice ? (
          <p className="mt-2 text-xs font-semibold text-brandGreen/70">{copyNotice}</p>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Status
            </p>
            <select
              value={draft.orderStatus}
              onChange={(event) => handleStatusChange(event.target.value)}
              className={selectClass}
            >
              {ORDER_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Tracking link (optional)
              </label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  type="url"
                  value={draft.trackingLink}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, trackingLink: event.target.value }))
                  }
                  className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                  placeholder="https://..."
                />
                <button
                  type="button"
                  onClick={handleTrackingSave}
                  disabled={trackingSaving}
                  className="rounded-full bg-brandGreen px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {trackingSaving ? "Saving..." : "Save"}
                </button>
              </div>
              {trackingMessage ? (
                <p className="text-xs font-semibold text-brandGreen/70">
                  {trackingMessage}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2 text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Totals
            </p>
            <div className="space-y-1 text-sm text-brandGreen">
              <p>
                Subtotal: <span className="font-semibold">{formatCurrency(eggsTotal)}</span>
              </p>
              <p>
                Delivery:{" "}
                <span className="font-semibold">{formatCurrency(deliveryCost)}</span>
              </p>
              <p className="text-lg font-bold text-brandGreen">
                Total: {formatCurrency(totalCost)}
              </p>
            </div>
            <p className="text-sm text-brandGreen">Paid: {order.paid ? "Yes" : "No"}</p>
            <p className="text-sm text-brandGreen">
              Delivery: {order.deliveryOption ?? "-"}
            </p>
            <p className="text-sm text-brandGreen">Send date: {order.sendDate ?? "-"}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Delivery address
            </p>
            <div className="flex items-center gap-2">
              <p className="text-brandGreen whitespace-pre-line">{addressText}</p>
              <button
                type="button"
                aria-label="Copy address"
                onClick={() => handleCopy(addressText, "Address")}
                className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Copy
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Contact
            </p>
            <div className="space-y-1 text-brandGreen">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{orderFullName || "Customer"}</span>
                <button
                  type="button"
                  aria-label="Copy name"
                  onClick={() => handleCopy(orderFullName, "Name")}
                  className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Copy
                </button>
              </div>
              {order.email ? (
                <div className="flex items-center gap-2">
                  <a className="underline" href={`mailto:${order.email}`}>
                    {order.email}
                  </a>
                  <button
                    type="button"
                    aria-label="Copy email"
                    onClick={() => handleCopy(order.email, "Email")}
                    className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
              {order.cellphone ? (
                <div className="flex items-center gap-2">
                  <a className="underline" href={`tel:${order.cellphone}`}>
                    {order.cellphone}
                  </a>
                  <button
                    type="button"
                    aria-label="Copy phone"
                    onClick={() => handleCopy(order.cellphone, "Phone")}
                    className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Bookkeeping attachments (optional)
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {ORDER_ATTACHMENTS.map((attachment) => {
              const attachmentUrl = order[attachment.urlField];
              const attachmentName = order[attachment.nameField];
              const isUploading = uploadingKey === attachment.key;
              return (
                <div
                  key={attachment.key}
                  className="rounded-2xl border border-brandGreen/10 bg-brandBeige/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                        {attachment.label}
                      </p>
                      {attachmentUrl ? (
                        <a
                          className="text-sm text-brandGreen underline decoration-brandGreen/40 underline-offset-4"
                          href={attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {attachmentName || "View file"}
                        </a>
                      ) : (
                        <p className="text-sm text-brandGreen/70">Not uploaded yet.</p>
                      )}
                    </div>
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige ${
                        isUploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                      }`}
                    >
                      <input
                        className="sr-only"
                        accept="application/pdf,image/*"
                        type="file"
                        disabled={isUploading}
                        onChange={(event) =>
                          handleAttachmentUpload(attachment, event.target.files?.[0])
                        }
                      />
                      {isUploading ? "Uploading..." : "Upload file"}
                    </label>
                  </div>
                  <p className="text-xs text-brandGreen/60">{attachment.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Delivery option
            </p>
            <select
              className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
              value={draft.deliveryOptionId}
              onChange={(event) => handleDeliveryChange(event.target.value)}
            >
              <option value="">Select delivery</option>
              {deliveryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({formatCurrency(option.cost)})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Send date
            </p>
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                type="date"
                value={draft.sendDate}
                onChange={(event) => handleSendDateChange(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDispatchEmail}
                  disabled={!canSendDispatch || dispatchSending}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {dispatchSending ? "Sending..." : "Send dispatch email"}
                </button>
                {dispatchMessage ? (
                  <span className="text-xs font-semibold text-brandGreen/70">
                    {dispatchMessage}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Notes / comments
          </p>
          <textarea
            className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
            value={draft.notes}
            readOnly
            rows={3}
          />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Internal note (not emailed to customer)
          </p>
          <textarea
            placeholder="Add private admin notes. This saves to the order but does not send an email."
            className="w-full rounded-lg border border-brandGreen/30 bg-brandBeige/40 px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
            value={draft.internalNote}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, internalNote: event.target.value }))
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-brandGreen/70">
              {internalNoteMessage}
            </span>
            <button
              type="button"
              onClick={handleInternalNoteSave}
              disabled={internalNoteSaving}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
            >
              {internalNoteSaving ? "Saving..." : "Save internal note"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            {breakdownTitle}
          </p>
          <div className="space-y-2">
            {lineItems.map((line) => {
              const optionExists = itemOptions.some((item) => item.id === line.itemId);
              return (
                <div
                  key={line.lineId}
                  className="flex flex-col gap-2 rounded-lg border border-brandGreen/15 bg-brandBeige/40 p-3 md:flex-row md:items-center"
                >
                  <select
                    className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                    value={line.itemId}
                    onChange={(event) => handleSelectItem(line.lineId, event.target.value)}
                  >
                    <option value="">{`Select ${itemLabelSingular}`}</option>
                    {itemOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    {!optionExists && line.itemId ? (
                      <option value={line.itemId}>{line.label || "Unknown"}</option>
                    ) : null}
                  </select>
                  <input
                    placeholder="Qty"
                    className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-32"
                    type="number"
                    value={line.quantity}
                    onChange={(event) =>
                      handleLineChange(line.lineId, {
                        quantity: event.target.value === "" ? "" : Number(event.target.value)
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(line.lineId)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={handleAddLine}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                {`Add ${itemLabelSingular} line`}
              </button>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleUpdateLines}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            Delete order
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPaidToggle(order)}
              className="rounded-full border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              {order.paid ? "Mark unpaid" : "Mark paid"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
