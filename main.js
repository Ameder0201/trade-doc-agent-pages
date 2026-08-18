const state = {
  cases: [],
  knowledge: { companies: [], consignees: [], fedex_products: [] },
  localHsKnowledge: [],
  current: null,
  activeGroupIndex: -1,
  remoteMode: false,
  draftHistory: [],
  draftFileName: "",
  historyQuery: "",
  activeHistoryId: "",
  draftPayload: null,
  dirty: false,
  saveState: "idle",
};

const draftHistoryDbName = "trade-doc-agent";
const draftHistoryStoreName = "draft-history";
const hsKnowledgeStoreName = "hs-knowledge";
const draftHistoryLimit = 50;
let draftHistoryDbPromise;

const fallbackKnowledge = {
  companies: [
    {
      code: "FT",
      keyword: "FT",
      company: "GUANGZHOU FUTONG TRADING CO.,LTD",
      address: "2/F, Tangli Building, 491 Zhongshan Avenue West, Tianhe Distric,Guangzhou,Guangdong,China",
      contact: "LEE JONGIN +86 13112664569",
      email: "jimmy@jimmylee.kr",
      block: "Guangzhou Futong Trading Co.,Ltd\nLEE JONGIN\n+86 13112664569  jimmy@jimmylee.kr\n2/F, Tangli Building, 491 Zhongshan Avenue West, Tianhe Distric,Guangzhou,Guangdong,China",
    },
    {
      code: "KL",
      keyword: "KL",
      company: "KUNLI TRADING CO., LIMITED",
      address: "UNIT 2508A 25/F, BANK OF AMERICA TOWER, 12 HARCOURT RD, CENTRAL, HONG KONG",
      contact: "ALI ALSHMERY +86 13763386357",
      email: "AILALSHMERY@YAHOO.COM",
      block: "KUNLI TRADING CO., LIMITED\nALI ALSHMERY\n+86 13763386357  AILALSHMERY@YAHOO.COM\nUNIT 2508A 25/F, BANK OF AMERICA TOWER, 12 HARCOURT RD, CENTRAL, HONG KONG",
    },
  ],
  consignees: [
    {
      code: "MUKADEM",
      keyword: "MUKADEM",
      company: "MUKADEM FACTORY FOR THE PRODUCTION OF GLASS",
      address: "AL FARWANIYAH GOVERNORATE, RAI, BLOCK1, STREET IBRAHIM MOHAMMAD AL_JRAIWY, PARCEL 286",
      contact: "ALI ALSHMERY 00965 65655842",
      email: "AILALSHMERY@YAHOO.COM",
    },
    {
      code: "MAWARED",
      keyword: "MAWARED",
      company: "MAWARED GLOBAL REAL ESTATE COMPANY",
      address: "Kuwait-Al farwaniyah governorate -Al Rigai. Block 2. Plot No 116. The Pavilin tower A. 7th floor. Office no 71A",
      contact: "+965 60455549",
      email: "AILALSHMERY@YAHOO.COM",
    },
  ],
  fedex_products: [],
};

const fieldLabels = {
  invoice_no: "发票号",
  invoice_date: "日期",
  shipper_block: "发货人资料",
  consignee_company: "收货人资料",
  transport: "运输方式",
  origin_country: "原产国",
  loading_port: "装港",
  destination_port: "目的港",
  trade_term: "交货条款",
  payment_term: "付款条款",
  gross_weight: "总毛重",
  si_template: "SI模板",
  container_qty: "柜量",
  vessel_voyage: "船名航次",
  bill_of_lading_no: "提单号",
  consignee_postcode: "收货人邮编",
  consignee_city: "收货人城市",
  destination_country: "目的国",
  total_packages: "总包裹数",
};

const seaFields = [
  "invoice_no",
  "invoice_date",
  "shipper_block",
  "consignee_company",
  "transport",
  "origin_country",
  "loading_port",
  "destination_port",
  "trade_term",
  "payment_term",
  "gross_weight",
];

const fedexFields = [
  "invoice_no",
  "invoice_date",
  "shipper_block",
  "consignee_company",
  "origin_country",
  "destination_country",
  "consignee_postcode",
  "consignee_city",
  "total_packages",
];

const fieldChoices = {
  trade_term: ["FOB", "EXW", "CIF SHUWAIKH", "CIF", "CFR SHUWAIKH", "CFR", "DAP", "DDP"],
  payment_term: ["T/T", "T/T USD", "L/C", "30% T/T DEPOSIT, 70% BEFORE LOADING"],
};

const invoiceNumberPattern = /^(FT|KL)(01|02)\d{6}\d{2}$/;

const siFields = [
  "si_template",
  "container_qty",
  "vessel_voyage",
  "bill_of_lading_no",
];

function qs(id) {
  return document.getElementById(id);
}

function openDraftHistoryDb() {
  if (!window.indexedDB) return Promise.reject(new Error("当前浏览器不支持本地历史存储"));
  if (draftHistoryDbPromise) return draftHistoryDbPromise;
  draftHistoryDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(draftHistoryDbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(draftHistoryStoreName)) {
        db.createObjectStore(draftHistoryStoreName, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(hsKnowledgeStoreName)) {
        db.createObjectStore(hsKnowledgeStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地历史"));
  });
  return draftHistoryDbPromise;
}

function historyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地历史操作失败"));
  });
}

async function readDraftHistory() {
  const db = await openDraftHistoryDb();
  const transaction = db.transaction(draftHistoryStoreName, "readonly");
  return historyRequest(transaction.objectStore(draftHistoryStoreName).getAll());
}

async function getDraftHistoryRecord(id) {
  const db = await openDraftHistoryDb();
  const transaction = db.transaction(draftHistoryStoreName, "readonly");
  return historyRequest(transaction.objectStore(draftHistoryStoreName).get(id));
}

async function writeDraftHistoryRecord(record) {
  const db = await openDraftHistoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(draftHistoryStoreName, "readwrite");
    transaction.objectStore(draftHistoryStoreName).put(record);
    transaction.oncomplete = () => resolve(record);
    transaction.onerror = () => reject(transaction.error || new Error("无法保存本地历史"));
    transaction.onabort = () => reject(transaction.error || new Error("本地历史保存已中止"));
  });
}

async function removeDraftHistoryRecords(ids) {
  if (!ids.length) return;
  const db = await openDraftHistoryDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(draftHistoryStoreName, "readwrite");
    const store = transaction.objectStore(draftHistoryStoreName);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("无法删除本地历史"));
    transaction.onabort = () => reject(transaction.error || new Error("本地历史删除已中止"));
  });
}

async function readLocalHsKnowledge() {
  const db = await openDraftHistoryDb();
  const transaction = db.transaction(hsKnowledgeStoreName, "readonly");
  return historyRequest(transaction.objectStore(hsKnowledgeStoreName).getAll());
}

async function writeLocalHsKnowledge(entries) {
  if (!entries.length) return;
  const db = await openDraftHistoryDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(hsKnowledgeStoreName, "readwrite");
    const store = transaction.objectStore(hsKnowledgeStoreName);
    entries.forEach((entry) => store.put(entry));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法保存 HS Code 参考"));
    transaction.onabort = () => reject(transaction.error || new Error("HS Code 参考保存已中止"));
  });
}

async function draftHistoryId(payload) {
  const text = JSON.stringify(payload);
  if (window.crypto?.subtle && window.TextEncoder) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `draft-${(hash >>> 0).toString(16)}`;
}

function draftHistoryMetadata(payload) {
  const groups = Array.isArray(payload.shipment_groups) ? payload.shipment_groups : [];
  const firstGroup = groups[0] || {};
  const caseNo = String(firstDefined(
    valueFromDraftField(payload.fields?.invoice_no),
    valueFromDraftField(firstGroup.invoice_no),
    payload.case_no,
    valueFromDraftField(firstGroup.bill_of_lading_no),
    "未命名整理稿",
  ));
  const itemCount = groups.length
    ? groups.reduce((sum, group) => sum + (group.items || []).length, 0)
    : (payload.items || []).length;
  return {
    caseNo,
    groupCount: groups.length || 1,
    itemCount,
    shipmentType: inferDraftShipmentType(payload),
  };
}

async function saveDraftHistory(rawText, payload, sourceName, existingId = "") {
  const id = existingId || await draftHistoryId(payload);
  const existing = await getDraftHistoryRecord(id);
  const now = new Date().toISOString();
  const record = {
    ...existing,
    ...draftHistoryMetadata(payload),
    id,
    rawText: rawText.trim(),
    sourceName: sourceName || existing?.sourceName || "粘贴导入",
    createdAt: existing?.createdAt || now,
    lastUsedAt: now,
  };
  await writeDraftHistoryRecord(record);
  const records = (await readDraftHistory()).sort((left, right) => String(right.lastUsedAt).localeCompare(String(left.lastUsedAt)));
  if (records.length > draftHistoryLimit) {
    await removeDraftHistoryRecords(records.slice(draftHistoryLimit).map((item) => item.id));
  }
  await refreshDraftHistory();
  return record;
}

function historyTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderDraftHistory() {
  const list = qs("historyList");
  if (!list) return;
  const query = state.historyQuery.trim().toLowerCase();
  const records = state.draftHistory.filter((record) => (
    !query
    || String(record.caseNo || "").toLowerCase().includes(query)
    || String(record.sourceName || "").toLowerCase().includes(query)
  ));
  qs("historyCount").textContent = String(state.draftHistory.length);
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = query ? "未找到匹配记录" : "暂无 JSON 导入历史";
    list.append(empty);
    return;
  }
  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "history-card";
    const title = document.createElement("div");
    title.className = "history-card-title";
    const strong = document.createElement("strong");
    strong.textContent = record.caseNo || "未命名整理稿";
    const time = document.createElement("span");
    time.className = "history-card-time";
    time.textContent = historyTime(record.lastUsedAt);
    title.append(strong, time);

    const source = document.createElement("div");
    source.className = "history-card-source";
    source.textContent = record.sourceName || "粘贴导入";

    const stats = document.createElement("div");
    stats.className = "history-card-stats";
    [record.shipmentType === "fedex" ? "FedEx 单票" : `提单组 ${record.groupCount || 1}`, `商品 ${record.itemCount || 0}`].forEach((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      stats.append(span);
    });

    const actions = document.createElement("div");
    actions.className = "history-card-actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "载入";
    loadButton.addEventListener("click", () => loadDraftFromHistory(record.id));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteDraftFromHistory(record.id));
    actions.append(loadButton, deleteButton);
    card.append(title, source, stats, actions);
    list.append(card);
  });
}

async function refreshDraftHistory() {
  try {
    state.draftHistory = (await readDraftHistory()).sort((left, right) => String(right.lastUsedAt).localeCompare(String(left.lastUsedAt)));
  } catch {
    state.draftHistory = [];
  }
  renderDraftHistory();
}

function setSourceView(view) {
  const selected = view === "history" ? "history" : "import";
  document.querySelectorAll("[data-source-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sourceView === selected);
  });
  qs("sourceViewImport").classList.toggle("active", selected === "import");
  qs("sourceViewHistory").classList.toggle("active", selected === "history");
  try {
    window.localStorage.setItem("tradeDocSourceView", selected);
  } catch {
    // The sidebar still works when browser storage is unavailable.
  }
}

function restoreSidebarState() {
  try {
    document.body.classList.toggle("sidebar-collapsed", window.localStorage.getItem("tradeDocSidebarCollapsed") === "true");
    setSourceView(window.localStorage.getItem("tradeDocSourceView") || "import");
  } catch {
    setSourceView("import");
  }
  updateSidebarToggle();
}

function updateSidebarToggle() {
  const collapsed = document.body.classList.contains("sidebar-collapsed");
  const button = qs("toggleSidebar");
  button.textContent = collapsed ? "›" : "‹";
  button.title = collapsed ? "展开资料栏" : "收起资料栏";
  button.setAttribute("aria-label", button.title);
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  try {
    window.localStorage.setItem("tradeDocSidebarCollapsed", String(collapsed));
  } catch {
    // Collapsing remains available for the current page when storage is unavailable.
  }
  updateSidebarToggle();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeHsCode(value) {
  return String(value || "").replace(/\D/g, "");
}

function originCountryDisplay(value = "") {
  const country = String(value || "CHINA").trim().toUpperCase() || "CHINA";
  return country.startsWith("MADE IN ") ? country : `MADE IN ${country}`;
}

function originCountryName(value = "") {
  return originCountryDisplay(value).replace(/^MADE IN\s+/i, "").trim() || "CHINA";
}

function normalizeProductText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/样品/g, " ")
    .replace(/\bSAMPLES?\b/g, " ")
    .replace(/[^A-Z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueHsCandidates(candidates = []) {
  const byCode = new Map();
  candidates.forEach((candidate) => {
    const record = typeof candidate === "string" ? { hs_code: candidate } : candidate || {};
    const code = String(record.hs_code || record.code || "").trim();
    const normalized = normalizeHsCode(code);
    if (!normalized || byCode.has(normalized)) return;
    byCode.set(normalized, {
      ...record,
      hs_code: code,
      normalized_hs_code: normalized,
    });
  });
  return [...byCode.values()];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function allFedexHsKnowledge() {
  const entries = [...(state.localHsKnowledge || []), ...(state.knowledge.fedex_products || [])];
  const byId = new Map();
  entries.forEach((entry) => {
    if (entry?.id && !byId.has(entry.id)) byId.set(entry.id, entry);
  });
  return [...byId.values()];
}

function matchFedexHsKnowledge(item, destinationCountry = "") {
  const description = normalizeProductText(`${item.description_en || ""} ${item.description_cn || ""}`);
  const descriptionVariants = new Set([
    description,
    normalizeProductText(item.description_en),
    normalizeProductText(item.description_cn),
  ].filter(Boolean));
  const context = normalizeProductText(`${item.description_en || ""} ${item.description_cn || ""} ${item.material || ""} ${item.use || ""}`);
  const destination = String(destinationCountry || "").trim().toUpperCase();
  const sourceCode = normalizeHsCode(item.hs_code);
  const matches = allFedexHsKnowledge().flatMap((entry) => {
    const countries = (entry.destination_countries || []).map((value) => String(value).trim().toUpperCase());
    if (destination && countries.length && !countries.includes(destination)) return [];
    const aliases = [entry.description_en, entry.description_cn, ...(entry.aliases_en || []), ...(entry.aliases_cn || [])]
      .map(normalizeProductText)
      .filter(Boolean);
    const aliasMatch = aliases.some((alias) => descriptionVariants.has(alias));
    const required = (entry.required_keywords || []).map((value) => String(value).toUpperCase());
    const requiredMatch = required.length > 0 && required.every((keyword) => context.includes(keyword));
    const materials = (entry.material_keywords || []).map((value) => String(value).toUpperCase());
    const materialMatch = !materials.length || materials.some((keyword) => context.includes(keyword));
    const codeMatch = sourceCode && sourceCode === normalizeHsCode(entry.hs_code);
    if (!aliasMatch && !requiredMatch && !codeMatch) return [];
    const score = (codeMatch ? 6 : 0) + (aliasMatch ? 4 : 0) + (requiredMatch ? 2 : 0) + (materialMatch ? 1 : -3) + (destination && countries.includes(destination) ? 1 : 0) + (entry.status === "browser_confirmed" ? 2 : 0);
    const matchedOn = [];
    if (codeMatch) matchedOn.push("hs_code");
    if (aliasMatch) matchedOn.push("product_alias");
    if (requiredMatch) matchedOn.push("required_keywords");
    if (materials.length && materialMatch) matchedOn.push("material");
    if (destination && countries.includes(destination)) matchedOn.push("destination_country");
    return [{ entry, score, matchedOn, aliasMatch, materialMatch }];
  }).sort((left, right) => right.score - left.score);
  if (!matches.length) {
    return {
      status: sourceCode ? "source_explicit" : "unresolved",
      knowledge_id: "",
      suggested_hs_code: item.hs_code || "",
      normalized_hs_code: sourceCode,
      matched_on: sourceCode ? ["source_document"] : [],
      source_count: 0,
      confidence: sourceCode ? "high" : "low",
      needs_confirmation: !sourceCode,
    };
  }
  const { entry, matchedOn, aliasMatch, materialMatch } = matches[0];
  const confirmed = ["confirmed", "browser_confirmed"].includes(entry.status);
  const candidateCodes = uniqueHsCandidates([
    {
      hs_code: entry.hs_code,
      source: entry.status === "browser_confirmed" ? "browser_confirmed" : "fedex_history_or_knowledge",
      source_label: entry.status === "browser_confirmed" ? "本机已确认" : "FedEx 历史参考",
      source_count: Number(entry.source_count || 0),
    },
    ...(entry.reference_conflicts || []).map((conflict) => ({
      hs_code: conflict.hs_code,
      source: "local_hscode_summary",
      source_label: `${conflict.source_file || "HSCODE汇总表.xlsx"}${conflict.row ? ` 第 ${conflict.row} 行` : ""}`,
      source_count: 1,
      evidence: conflict,
    })),
  ]);
  const referenceConflict = !sourceCode && candidateCodes.length > 1;
  return {
    status: sourceCode ? "source_explicit" : !referenceConflict && confirmed && aliasMatch && materialMatch ? "confirmed_exact" : "candidate",
    knowledge_id: entry.id,
    suggested_hs_code: item.hs_code || entry.hs_code || "",
    normalized_hs_code: sourceCode || normalizeHsCode(entry.hs_code),
    matched_on: matchedOn,
    source_count: Number(entry.source_count || 0),
    candidate_codes: referenceConflict ? candidateCodes : [],
    reference_conflict: referenceConflict,
    knowledge_status: entry.status || "candidate",
    confidence: sourceCode || (!referenceConflict && confirmed && aliasMatch && materialMatch) ? "high" : aliasMatch ? "medium" : "low",
    needs_confirmation: sourceCode ? false : referenceConflict || !(confirmed && aliasMatch && materialMatch),
  };
}

function applyFedexHsKnowledge(data) {
  if (data?.case?.shipment_type !== "fedex") return;
  const destination = fieldValue(data, "destination_country", "");
  (data.items || []).forEach((item) => {
    const existing = item.hs_code_reference || {};
    const reference = matchFedexHsKnowledge(item, destination);
    if (existing.status && !["unresolved", "candidate"].includes(existing.status)) return;
    const existingCandidates = uniqueHsCandidates(existing.candidate_codes || []);
    if (existingCandidates.length) {
      const matchedCandidates = uniqueHsCandidates([
        ...(reference.candidate_codes || []),
        reference.suggested_hs_code ? {
          hs_code: reference.suggested_hs_code,
          source: reference.knowledge_status === "browser_confirmed" ? "browser_confirmed" : "fedex_history_or_knowledge",
          source_label: reference.knowledge_status === "browser_confirmed" ? "本机已确认" : "FedEx 历史参考",
          source_count: reference.source_count || 0,
        } : null,
      ].filter(Boolean));
      const combined = uniqueHsCandidates([...existingCandidates, ...matchedCandidates]);
      item.hs_code_reference = {
        ...existing,
        status: "candidate",
        candidate_codes: combined,
        reference_conflict: combined.length > 1,
        suggested_hs_code: existing.suggested_hs_code || combined[0]?.hs_code || "",
        needs_confirmation: true,
      };
      if (combined.length > 1 && !["source_explicit", "browser_confirmed"].includes(existing.status)) item.hs_code = "";
      return;
    }
    if (existing.status === "candidate" && reference.knowledge_status !== "browser_confirmed") return;
    item.hs_code_reference = reference;
    if (!item.hs_code && reference.status === "confirmed_exact") item.hs_code = reference.suggested_hs_code;
  });
}

function knowledgeStatusText() {
  const count = state.localHsKnowledge.length;
  qs("knowledgeStatus").textContent = `本机已确认 ${count} 条；正式参考 ${state.knowledge.fedex_products?.length || 0} 条`;
}

async function refreshLocalHsKnowledge() {
  try {
    state.localHsKnowledge = await readLocalHsKnowledge();
  } catch {
    state.localHsKnowledge = [];
  }
  knowledgeStatusText();
}

function localKnowledgeEntry(item, hsCode) {
  const normalizedDescription = normalizeProductText(`${item.description_en || ""} ${item.description_cn || ""}`);
  const normalizedCode = normalizeHsCode(hsCode);
  const id = `browser-${normalizedDescription.toLowerCase().replace(/\s+/g, "-")}-${normalizedCode}`;
  return {
    id,
    description_en: item.description_en || "",
    description_cn: item.description_cn || "",
    aliases_en: [],
    aliases_cn: [],
    material_en: item.material || "",
    material_cn: "",
    use_en: item.use || "",
    use_cn: "",
    default_unit: "PCS",
    hs_code: String(hsCode),
    hs_code_raw: [String(hsCode)],
    destination_countries: [getField("destination_country")].filter(Boolean),
    status: "browser_confirmed",
    source_count: 1,
    source_files: [state.draftFileName || "browser_review"],
    confirmed_at: new Date().toISOString(),
    required_keywords: normalizedDescription.split(" ").filter((token) => token.length > 2 && !["SAMPLE", "ACCESSORY", "PART", "PROFILE"].includes(token)),
    material_keywords: normalizeProductText(item.material).split(" ").filter(Boolean),
  };
}

async function confirmHsReference(rowIndex, selectedCode = "") {
  const item = state.current?.items?.[rowIndex];
  if (!item) return;
  const reference = item.hs_code_reference || {};
  const candidates = uniqueHsCandidates(reference.candidate_codes || []);
  const code = String(selectedCode || item.hs_code || reference.suggested_hs_code || "").trim();
  if (!normalizeHsCode(code)) {
    window.alert("请先填写或采用一个 HS Code。");
    return;
  }
  const selectedCandidate = candidates.find((candidate) => candidate.normalized_hs_code === normalizeHsCode(code));
  item.hs_code = code;
  item.hs_code_reference = {
    ...reference,
    status: "browser_confirmed",
    suggested_hs_code: code,
    normalized_hs_code: normalizeHsCode(code),
    selected_hs_code: code,
    selected_candidate: selectedCandidate || null,
    selected_from_conflict: candidates.length > 1,
    selected_at: new Date().toISOString(),
    matched_on: [...new Set([...(reference.matched_on || []), "user_confirmation"])],
    confidence: "high",
    needs_confirmation: false,
  };
  const entry = localKnowledgeEntry(item, code);
  await writeLocalHsKnowledge([entry]);
  await refreshLocalHsKnowledge();
  state.current.knowledge_feedback = (state.current.knowledge_feedback || []).filter((feedback) => feedback.id !== entry.id);
  state.current.knowledge_feedback.push({
    ...entry,
    action: candidates.length > 1 ? "selected_from_reference_conflict" : "confirmed",
    candidate_codes: candidates,
    selected_candidate: selectedCandidate || null,
  });
  state.current.issues = (state.current.issues || []).filter((issue) => !(
    issue.type === "hs_code_reference_conflict" && issue.field === `items[${rowIndex}].hs_code`
  ));
  state.current = validateInBrowser(state.current);
  markDirty();
  renderItems();
  renderSummary();
  renderIssues();
  await persistCurrentDraft();
}

function rejectHsReference(rowIndex) {
  const item = state.current?.items?.[rowIndex];
  if (!item) return;
  const previous = item.hs_code_reference || {};
  if (item.hs_code === previous.suggested_hs_code && previous.status === "candidate") item.hs_code = "";
  item.hs_code_reference = { ...previous, status: "rejected", needs_confirmation: false };
  state.current.knowledge_feedback = state.current.knowledge_feedback || [];
  state.current.knowledge_feedback.push({
    knowledge_id: previous.knowledge_id || "",
    description_en: item.description_en || "",
    suggested_hs_code: previous.suggested_hs_code || "",
    action: "rejected",
    reviewed_at: new Date().toISOString(),
  });
  state.current = validateInBrowser(state.current);
  markDirty();
  renderItems();
  renderSummary();
  renderIssues();
}

async function importKnowledgeFile() {
  const file = qs("knowledgeFile").files?.[0];
  if (!file) {
    qs("knowledgeStatus").textContent = "请先选择知识增量 JSON 文件";
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    const entries = Array.isArray(payload) ? payload : payload.entries || payload.knowledge_feedback || [];
    const valid = entries.filter((entry) => entry?.id && entry?.hs_code && (entry.description_en || entry.description_cn));
    await writeLocalHsKnowledge(valid);
    await refreshLocalHsKnowledge();
    if (state.current) {
      applyFedexHsKnowledge(state.current);
      renderAll();
    }
    qs("knowledgeStatus").textContent = `已导入 ${valid.length} 条；本机共 ${state.localHsKnowledge.length} 条`;
  } catch (error) {
    qs("knowledgeStatus").textContent = `知识增量导入失败：${error.message}`;
  }
}

function exportLocalKnowledge() {
  const payload = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    entries: state.localHsKnowledge,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fedex-hs-knowledge-${localDateParts().compact}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateSaveButton() {
  const button = qs("saveButton");
  if (!button) return;
  button.disabled = !state.current;
  button.classList.toggle("dirty", state.saveState === "dirty");
  button.classList.toggle("saved", state.saveState === "saved");
  button.classList.toggle("save-error", state.saveState === "error");
  if (state.saveState === "dirty") {
    button.textContent = "保存修改";
    button.title = "保存当前整理稿的全部提单修改";
  } else if (state.saveState === "saved") {
    button.textContent = "已保存";
    button.title = "修改已保存到当前浏览器历史";
  } else if (state.saveState === "error") {
    button.textContent = "保存失败";
    button.title = "未能保存，请再次尝试";
  } else {
    button.textContent = "保存";
    button.title = "保存当前整理稿";
  }
}

function setSaveState(saveState) {
  state.saveState = saveState;
  state.dirty = saveState === "dirty";
  updateSaveButton();
}

function markDirty() {
  if (!state.current) return;
  setSaveState("dirty");
}

async function loadDraftFromHistory(id) {
  const record = state.draftHistory.find((item) => item.id === id) || await getDraftHistoryRecord(id);
  if (!record) return;
  try {
    const payload = extractJsonFromText(record.rawText);
    state.draftFileName = record.sourceName || "";
    qs("draftText").value = record.rawText;
    applyDraft(payload);
    state.activeHistoryId = record.id;
    setSaveState("saved");
    await writeDraftHistoryRecord({ ...record, lastUsedAt: new Date().toISOString() });
    await refreshDraftHistory();
    setSourceView("import");
    qs("draftImportPanel").open = true;
    qs("importStatus").textContent = `已从历史载入：${record.caseNo || record.sourceName}`;
  } catch (error) {
    qs("importStatus").textContent = `历史载入失败：${error.message}`;
  }
}

async function deleteDraftFromHistory(id) {
  const record = state.draftHistory.find((item) => item.id === id);
  if (!window.confirm(`删除历史记录“${record?.caseNo || "未命名整理稿"}”？`)) return;
  await removeDraftHistoryRecords([id]);
  await refreshDraftHistory();
}

async function clearDraftHistory() {
  if (!state.draftHistory.length) return;
  if (!window.confirm(`清空当前浏览器中的 ${state.draftHistory.length} 条 JSON 历史？`)) return;
  await removeDraftHistoryRecords(state.draftHistory.map((item) => item.id));
  await refreshDraftHistory();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function fieldValue(data, name, fallback = "") {
  return data?.fields?.[name]?.value ?? fallback;
}

function extractionIssueIsCurrent(issue, data) {
  const reconciliationIssueKeys = {
    cbm_source_difference: "cbm",
    packing_cbm_differs_from_bl: "cbm",
    gross_weight_source_difference: "gross_weight",
    packing_gross_differs_from_bl: "gross_weight",
  };
  const reconciliationKey = reconciliationIssueKeys[String(issue.type || "")];
  if (reconciliationKey && data.packing_reconciliation?.[reconciliationKey]) return false;
  const match = String(issue.field || "").match(/^(items|packing_lines)\[(\d+)\](?:\.|$)/);
  if (!match) return true;
  return Number(match[2]) < (data[match[1]] || []).length;
}

function applyDefaultNetWeights(data) {
  (data?.packing_lines || []).forEach((line) => {
    if (line.net_weight !== null && line.net_weight !== "" && line.net_weight !== undefined) return;
    const grossWeight = Number(line.gross_weight || 0);
    if (!(grossWeight > 0)) return;
    line.net_weight = Number((grossWeight * 0.9).toFixed(3));
    line.net_weight_method = "default_90_percent_of_gross";
  });
}

function decimalPlaces(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  if (/e-/i.test(text)) return Number(text.split(/e-/i)[1] || 0);
  return text.includes(".") ? text.split(".").pop().length : 0;
}

function reconciliationTolerance(key, target) {
  return Math.max(key === "gross_weight" ? 1 : 0.01, Math.abs(target) * 0.0005);
}

function reconcilePackingTotals(data, applyAdjustment = true) {
  const lines = data?.packing_lines || [];
  const totals = data?.bl_totals || {};
  if (!data.packing_reconciliation) data.packing_reconciliation = {};
  const units = { gross_weight: "KGS", cbm: "CBM" };

  ["gross_weight", "cbm"].forEach((key) => {
    const target = sourceTotalNumber(totals, key);
    if (target === null) {
      delete data.packing_reconciliation[key];
      return;
    }
    const values = lines.map((line) => Number(line[key] || 0));
    const actual = values.reduce((sum, value) => sum + value, 0);
    const difference = target - actual;
    const tolerance = reconciliationTolerance(key, target);
    const rate = target ? Math.abs(difference) / Math.abs(target) * 100 : 0;
    const previous = data.packing_reconciliation[key];

    if (Math.abs(difference) < 1e-12 && previous?.status === "adjusted" && Math.abs(Number(previous.detail_total_after) - target) < 1e-12) {
      return;
    }

    let status = Math.abs(difference) < 1e-12 ? "matched" : "anomaly";
    let adjustedTotal = actual;
    if (applyAdjustment && Math.abs(difference) >= 1e-12 && Math.abs(difference) <= tolerance && actual > 0) {
      const eligible = values.map((value, index) => ({ value, index })).filter(({ value }) => value > 0);
      if (eligible.length) {
        const displayPrecision = decimalPlaces(totals[`${key}_display`]);
        const precision = Math.min(8, Math.max(3, displayPrecision, ...values.map(decimalPlaces)));
        const factor = 10 ** precision;
        let assigned = 0;
        eligible.forEach(({ value, index }, position) => {
          const adjusted = position === eligible.length - 1
            ? Number((target - assigned).toFixed(precision))
            : Math.round((value + difference * value / actual) * factor) / factor;
          const adjustment = adjusted - value;
          lines[index][key] = adjusted;
          lines[index][`${key}_reconciliation_adjustment`] = Number(adjustment.toFixed(precision));
          if (key === "gross_weight" && lines[index].net_weight_method === "default_90_percent_of_gross") {
            lines[index].net_weight = Number((adjusted * 0.9).toFixed(3));
          }
          assigned += adjusted;
        });
        adjustedTotal = lines.reduce((sum, line) => sum + Number(line[key] || 0), 0);
        status = "adjusted";
      }
    }

    data.packing_reconciliation[key] = {
      status,
      unit: units[key],
      detail_total_before: actual,
      detail_total_after: adjustedTotal,
      bill_total: target,
      difference,
      absolute_difference: Math.abs(difference),
      error_rate_percent: rate,
      tolerance,
    };
  });
  return data.packing_reconciliation;
}

function validateInBrowser(data) {
  applyDefaultNetWeights(data);
  const reconciliation = reconcilePackingTotals(data, true);
  const issues = (data.issues || []).filter(
    (issue) => (!issue.source || issue.source === "trade-doc-summary-extractor") && extractionIssueIsCurrent(issue, data),
  );
  const add = (level, type, message, field) => issues.push({ level, type, message, field, source: "browser-validator" });
  const fields = data.fields || {};
  const shipmentType = data.case?.shipment_type;
  if (shipmentType === "sea" && (data.shipment_groups || []).length > 1 && !data.active_group_id) {
    add("error", "multiple_bill_of_lading", `检测到 ${data.shipment_groups.length} 个提单号，需要先在拆单页选择一个提单组再导出 PIPKG`, "shipment_groups");
  }
  const required = ["invoice_no", "invoice_date", "shipper_block", "consignee_company"];
  if (shipmentType === "sea") required.push("loading_port", "destination_port");
  if (shipmentType === "fedex") required.push("destination_country", "total_packages");
  required.forEach((name) => {
    if (!fields[name]?.value) add("error", "missing_required", `缺少必填字段：${name}`, name);
  });
  if (!(data.items || []).length) add("error", "missing_items", "缺少商品明细，需要人工录入或补充资料", "items");
  (data.items || []).forEach((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const amount = Number(item.amount || 0);
    const expected = Number((quantity * unitPrice).toFixed(2));
    if (Math.abs(expected - amount) > 0.05) add("warning", "amount_mismatch", `第 ${index + 1} 行金额不一致：数量*单价=${expected.toFixed(2)}，来源金额=${amount.toFixed(2)}`, `items[${index}].amount`);
    if (!(quantity > 0)) add("error", "invalid_quantity", `第 ${index + 1} 行缺少有效商品数量`, `items[${index}].quantity`);
    if (shipmentType === "fedex" && normalizeQuantityUnit(item.unit) !== "PCS") {
      add("error", "fedex_quantity_requires_pcs", `第 ${index + 1} 行 FedEx 数量必须核验为 PCS`, `items[${index}].unit`);
    }
    if (shipmentType === "fedex" && (item.unit_price === "" || item.unit_price === null || item.unit_price === undefined || !Number.isFinite(unitPrice) || unitPrice < 0)) {
      add("error", "missing_fedex_price", `第 ${index + 1} 行缺少有效 FedEx 单价`, `items[${index}].unit_price`);
    }
    if (shipmentType === "fedex" && item.unit_price_method === "ai_estimate" && item.price_confirmed !== true) {
      add("error", "unconfirmed_ai_price", `第 ${index + 1} 行使用 AI 估价，必须人工确认或修改`, `items[${index}].unit_price`);
    }
    if (shipmentType === "fedex" && item.hs_code_reference?.needs_confirmation) {
      add("error", "unconfirmed_hs_code_reference", `第 ${index + 1} 行 HS Code 仍为候选，需要确认、修改或拒绝`, `items[${index}].hs_code`);
    }
    if (!item.hs_code) add(shipmentType === "fedex" ? "error" : "warning", "missing_hs_code", `第 ${index + 1} 行缺少 HS code`, `items[${index}].hs_code`);
    const reviewedUnit = normalizeQuantityUnit(item.unit);
    const sourceUnit = normalizeQuantityUnit(item.quantity_source_unit);
    if (reviewedUnit === "PKGS") add("error", "package_count_used_as_quantity", `第 ${index + 1} 行把 PKGS 当作商品 Quantity；请填写实际件数、米数或其他货物数量`, `items[${index}].quantity`);
    if (reviewedUnit === "SET" && (item.quantity_source_unit || String(item.source || "").includes("整理稿")) && !String(item.set_basis || "").trim()) {
      add("error", "set_without_source_basis", `第 ${index + 1} 行使用 SET，但没有来源明确的成套依据；分类汇总不能直接写成 1 SET`, `items[${index}].unit`);
    }
    if (sourceUnit === "M" && reviewedUnit === "PCS") {
      const sourceQuantity = Number(item.quantity_source || 0);
      const pieceLength = Number(item.piece_length_m || 0);
      if (!(pieceLength > 0)) {
        add("error", "missing_piece_length", `第 ${index + 1} 行把米数换算为件数，但缺少可靠的单件长度`, `items[${index}].piece_length_m`);
      } else {
        const expectedPieces = sourceQuantity / pieceLength;
        if (Math.abs(expectedPieces - quantity) > 0.001) {
          add("error", "piece_count_mismatch", `第 ${index + 1} 行米数换算不一致：${sourceQuantity} M ÷ ${pieceLength} M/PC = ${expectedPieces} PCS，当前为 ${quantity} PCS`, `items[${index}].quantity`);
        }
      }
    }
  });
  if (shipmentType === "fedex" && (data.items || []).some((item) => item.unit_price_method === "ai_estimate")) {
    const total = (data.items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
    const cap = Number(data.fedex_pricing?.estimated_total_cap_usd || 80);
    if (total > cap + 0.001) add("error", "fedex_ai_estimate_cap_exceeded", `含 AI 估价的 FedEx 发票总额 USD ${total.toFixed(2)} 超过上限 USD ${cap.toFixed(2)}`, "fedex_pricing");
  }
  (data.packing_lines || []).forEach((line, index) => {
    if (line.gross_weight === null || line.gross_weight === "" || line.gross_weight === undefined) {
      add("warning", "missing_packing_weight", `包装第 ${index + 1} 行缺少毛重，导出前建议人工补录`, `packing_lines[${index}].gross_weight`);
    }
  });
  const anomalyLabels = { gross_weight: "毛重", cbm: "体积" };
  Object.entries(reconciliation || {}).forEach(([key, result]) => {
    if (result.status !== "anomaly") return;
    add(
      "warning",
      `${key}_anomaly`,
      `${anomalyLabels[key]}异常：装箱明细 ${result.detail_total_before} ${result.unit}，提单 ${result.bill_total} ${result.unit}，绝对差值 ${result.absolute_difference}，误差率 ${result.error_rate_percent.toFixed(4)}%；最终总计仍以提单为准`,
      `bl_totals.${key}`,
    );
  });
  return { ...data, issues };
}

function setWorkbookCell(sheet, address, value) {
  sheet.getCell(address).value = value ?? "";
}

function clearWorkbookRows(sheet, fromRow, toRow, fromColumn, toColumn) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = fromColumn; column <= toColumn; column += 1) {
      const cell = sheet.getCell(row, column);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      cell.value = null;
    }
  }
}

function cloneWorkbookStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

function copyWorkbookCellStyle(sheet, sourceAddress, targetAddress) {
  sheet.getCell(targetAddress).style = cloneWorkbookStyle(sheet.getCell(sourceAddress).style);
}

function preparePipkgTableLayout(pi, pkg) {
  for (let row = 18; row <= 37; row += 1) {
    const rightEdgeStyle = cloneWorkbookStyle(pi.getCell(`C${row}`).style);
    pi.unMergeCells(`A${row}:C${row}`);
    pi.getCell(`B${row}`).style = rightEdgeStyle;
    pi.mergeCells(`A${row}:B${row}`);
    copyWorkbookCellStyle(pi, `D${row}`, `C${row}`);
  }
  pi.getColumn("A").width = 20;
  pi.getColumn("B").width = 25;
  pi.getColumn("C").width = 18;
  pi.getColumn("D").width = 12;
  pi.getColumn("E").width = 13.4;
  pi.getColumn("F").width = 16;
  setWorkbookCell(pi, "C18", "Quantity");
  setWorkbookCell(pi, "D18", "UNIT");
  setWorkbookCell(pi, "E18", "Unit Price");
  setWorkbookCell(pi, "F18", "Amount\nUSD");
  setWorkbookCell(pi, "D37", "");
  setWorkbookCell(pi, "E37", "");
  for (let row = 18; row <= 37; row += 1) setWorkbookCell(pi, `G${row}`, "");
  pi.pageSetup.printArea = "A1:F50";

  for (let row = 14; row <= 33; row += 1) {
    pkg.unMergeCells(`A${row}:B${row}`);
    copyWorkbookCellStyle(pkg, `C${row}`, `B${row}`);
  }
  pkg.getColumn("A").width = 52.05;
  pkg.getColumn("B").width = 12;
  pkg.getColumn("C").width = 9;
  pkg.getColumn("D").width = 9;
  pkg.getColumn("E").width = 13;
  pkg.getColumn("F").width = 13;
  pkg.getColumn("G").width = 13;
  pkg.getColumn("H").width = 17;
  setWorkbookCell(pkg, "B14", "QUANTITY");
  setWorkbookCell(pkg, "C14", "UNIT");
  setWorkbookCell(pkg, "D14", "PKG");
  setWorkbookCell(pkg, "E14", "G.W.(KGS)");
  setWorkbookCell(pkg, "F14", "N.W.(KGS)");
  setWorkbookCell(pkg, "G14", "TTL CBM");
  setWorkbookCell(pkg, "H14", "HS CODE");
  setWorkbookCell(pkg, "C33", "");
  setWorkbookCell(pkg, "H33", "");
  for (let row = 14; row <= 33; row += 1) setWorkbookCell(pkg, `I${row}`, "");
  pkg.pageSetup.printArea = "A1:H35";
}

function deliveryAndPaymentText(data) {
  const payment = String(fieldValue(data, "payment_term", "") || "").trim();
  let delivery = String(fieldValue(data, "trade_term", "") || "").trim();
  const destination = String(fieldValue(data, "destination_port", "") || "").trim();
  if (/^(CIF|CFR|CPT|CIP)$/i.test(delivery) && destination) {
    delivery = `${delivery} ${destination}`;
  }
  return [payment, delivery].filter(Boolean).join(" ");
}

function sourceTotalNumber(totals, key) {
  const raw = valueFromDraftField(totals?.[key]);
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function sourceNumberFormat(display, fallbackDecimals = 3) {
  const text = String(valueFromDraftField(display) || "").replace(/,/g, "").trim();
  const decimals = text.includes(".") ? text.split(".").pop().length : fallbackDecimals;
  return `#,##0${decimals ? `.${"0".repeat(decimals)}` : ""}`;
}

function itemNameWithHsCode(description, hsCode) {
  const name = String(description || "").trim();
  const code = String(hsCode || "").trim();
  return [name, code ? `HSCODE:${code}` : ""].filter(Boolean).join(" ");
}

async function exportPipkgInBrowser(data) {
  if (!window.ExcelJS) throw new Error("Excel 导出组件未加载");
  applyDefaultNetWeights(data);
  reconcilePackingTotals(data, true);
  const templateResponse = await fetch("./templates/FT0126021101样例.xlsx");
  if (!templateResponse.ok) throw new Error("无法读取 PIPKG 模板");
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await templateResponse.arrayBuffer());
  const pi = workbook.getWorksheet("PI");
  const pkg = workbook.getWorksheet("PKG");
  if (!pi || !pkg) throw new Error("PIPKG 模板缺少 PI 或 PKG 工作表");
  preparePipkgTableLayout(pi, pkg);
  const caseNo = data.case?.case_no || fieldValue(data, "invoice_no", "UNNAMED");
  [pi, pkg].forEach((sheet) => setWorkbookCell(sheet, "C7", caseNo));
  setWorkbookCell(pi, "E7", fieldValue(data, "invoice_date"));
  setWorkbookCell(pkg, "F7", fieldValue(data, "invoice_date"));
  setWorkbookCell(pi, "A3", fieldValue(data, "shipper_block"));
  setWorkbookCell(pkg, "A3", fieldValue(data, "shipper_block"));
  setWorkbookCell(pi, "A5", fieldValue(data, "consignee_company"));
  setWorkbookCell(pkg, "A5", fieldValue(data, "consignee_company"));
  setWorkbookCell(pi, "A13", fieldValue(data, "transport", "BY SEA"));
  setWorkbookCell(pkg, "A9", fieldValue(data, "transport", "BY SEA"));
  setWorkbookCell(pi, "B13", fieldValue(data, "loading_port"));
  setWorkbookCell(pkg, "B9", fieldValue(data, "loading_port"));
  setWorkbookCell(pi, "A15", fieldValue(data, "destination_port"));
  setWorkbookCell(pkg, "A11", fieldValue(data, "destination_port"));
  const paymentText = deliveryAndPaymentText(data);
  setWorkbookCell(pi, "C15", paymentText);
  setWorkbookCell(pkg, "C11", paymentText);
  clearWorkbookRows(pi, 19, 34, 1, 6);
  clearWorkbookRows(pkg, 15, 32, 1, 8);
  const items = (data.items || []).slice(0, 16);
  let totalQuantity = 0;
  let totalAmount = 0;
  items.forEach((item, index) => {
    const row = 19 + index;
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const amount = quantity * unitPrice;
    setWorkbookCell(pi, `A${row}`, itemNameWithHsCode(item.description_en, item.hs_code));
    setWorkbookCell(pi, `C${row}`, quantity);
    setWorkbookCell(pi, `D${row}`, normalizeQuantityUnit(item.unit));
    setWorkbookCell(pi, `E${row}`, unitPrice);
    pi.getCell(`F${row}`).value = { formula: `C${row}*E${row}`, result: amount };
    pi.getCell(`F${row}`).numFmt = "#,##0.00";
    totalQuantity += quantity;
    totalAmount += amount;
  });
  const packing = (data.packing_lines || []).length
    ? data.packing_lines
    : (data.items || []).map((item) => ({ ...item, packages: "", gross_weight: "", net_weight: "", cbm: "" }));
  const packingTotals = { B: 0, D: 0, E: 0, F: 0, G: 0 };
  packing.slice(0, 18).forEach((line, index) => {
    const row = 15 + index;
    const values = {
      B: Number(line.quantity || 0),
      D: Number(line.packages || 0),
      E: line.gross_weight === "" ? 0 : Number(line.gross_weight || 0),
      F: line.net_weight === "" ? 0 : Number(line.net_weight || 0),
      G: line.cbm === "" ? 0 : Number(line.cbm || 0),
    };
    setWorkbookCell(pkg, `A${row}`, itemNameWithHsCode(line.description_en, line.hs_code));
    setWorkbookCell(pkg, `B${row}`, values.B);
    setWorkbookCell(pkg, `C${row}`, normalizeQuantityUnit(line.unit));
    setWorkbookCell(pkg, `D${row}`, values.D);
    setWorkbookCell(pkg, `E${row}`, line.gross_weight === "" ? "" : values.E);
    setWorkbookCell(pkg, `F${row}`, line.net_weight === "" ? "" : values.F);
    setWorkbookCell(pkg, `G${row}`, line.cbm === "" ? "" : values.G);
    setWorkbookCell(pkg, `H${row}`, line.hs_code || "");
    Object.keys(packingTotals).forEach((column) => {
      packingTotals[column] += values[column];
    });
  });
  pi.getCell("C37").value = { formula: "SUM(C19:C34)", result: totalQuantity };
  pi.getCell("F37").value = { formula: "SUM(F19:F34)", result: totalAmount };
  pi.getCell("F37").numFmt = "#,##0.00";
  const blGrossWeight = sourceTotalNumber(data.bl_totals, "gross_weight");
  const blCbm = sourceTotalNumber(data.bl_totals, "cbm");
  Object.entries(packingTotals).forEach(([column, result]) => {
    const sourceValue = column === "E" ? blGrossWeight : column === "G" ? blCbm : null;
    if (sourceValue !== null) {
      setWorkbookCell(pkg, `${column}33`, sourceValue);
      const key = column === "E" ? "gross_weight" : "cbm";
      pkg.getCell(`${column}33`).numFmt = sourceNumberFormat(data.bl_totals?.[`${key}_display`]);
      return;
    }
    pkg.getCell(`${column}33`).value = { formula: `SUM(${column}15:${column}32)`, result };
  });
  workbook.calcProperties.calcMode = "auto";
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `${caseNo} PI PKG.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  return anchor.download;
}

function safeUnmergeWorkbookCells(sheet, range) {
  try {
    sheet.unMergeCells(range);
  } catch {
    // Template variants may already have this range unmerged.
  }
}

function copyFedexWorkbookRowStyle(sheet, sourceRow, targetRow) {
  sheet.getRow(targetRow).height = sheet.getRow(sourceRow).height;
  for (let column = 1; column <= 11; column += 1) {
    const source = sheet.getCell(sourceRow, column);
    const target = sheet.getCell(targetRow, column);
    target.style = cloneWorkbookStyle(source.style);
    target.numFmt = source.numFmt;
    target.value = null;
  }
}

function prepareFedexWorkbookLayout(sheet, itemCount) {
  safeUnmergeWorkbookCells(sheet, "A21:D21");
  copyFedexWorkbookRowStyle(sheet, 20, 21);
  let totalRow = 22;
  safeUnmergeWorkbookCells(sheet, "G22:J22");
  const extraRows = Math.max(0, itemCount - 4);
  if (extraRows) {
    sheet.insertRows(totalRow, Array.from({ length: extraRows }, () => Array(11).fill(null)), "i");
    for (let row = totalRow; row < totalRow + extraRows; row += 1) copyFedexWorkbookRowStyle(sheet, 21, row);
    totalRow += extraRows;
  }
  sheet.mergeCells(`G${totalRow}:J${totalRow}`);
  const lastItemRow = Math.max(21, 17 + itemCount);
  for (let row = 18; row <= lastItemRow; row += 1) {
    if (!sheet.getCell(`H${row}`).isMerged) sheet.mergeCells(`H${row}:I${row}`);
  }
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:K${totalRow + 1}`,
    printTitlesRow: "16:17",
  };
  return { totalRow, lastItemRow };
}

function fedexWorkbookRowHeight(...values) {
  let lines = 1;
  values.forEach((value) => {
    const count = String(value || "").split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 28)), 0);
    lines = Math.max(lines, count);
  });
  return Math.min(240, Math.max(45.75, lines * 22.5));
}

function fieldValueAny(data, names, fallback = "") {
  for (const name of names) {
    const value = fieldValue(data, name, null);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return fallback;
}

function partyLines(data, type) {
  const blockNames = type === "shipper" ? ["shipper_block"] : ["consignee_block", "consignee_company"];
  return String(fieldValueAny(data, blockNames, "") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function phoneFromLines(lines) {
  return String(lines.join(" ").match(/\+?\d[\d\s-]{7,}/)?.[0] || "").trim();
}

function fedexDateNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? Number(digits) : value;
}

async function exportFedexInBrowser(data) {
  if (!window.ExcelJS) throw new Error("Excel 导出组件未加载");
  const templateResponse = await fetch("./templates/FedExCommercialInvoiceTemplate.xlsx");
  if (!templateResponse.ok) throw new Error("无法读取 FedEx Commercial Invoice 模板");
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await templateResponse.arrayBuffer());
  const sheet = workbook.getWorksheet("发票");
  if (!sheet) throw new Error("FedEx 模板缺少“发票”工作表");
  const items = data.items || [];
  const { totalRow, lastItemRow } = prepareFedexWorkbookLayout(sheet, items.length);
  const caseNo = fieldValue(data, "invoice_no", data.case?.case_no || data.case_no || "UNNAMED");
  setWorkbookCell(sheet, "E3", fedexDateNumber(fieldValue(data, "invoice_date")));
  setWorkbookCell(sheet, "I3", caseNo);

  const shipper = partyLines(data, "shipper");
  const consignee = partyLines(data, "consignee");
  const shipperCompany = fieldValueAny(data, ["shipper_company"], shipper[0] || "");
  const shipperContact = fieldValueAny(data, ["shipper_contact"], shipper[1] || "");
  const shipperAddress = fieldValueAny(data, ["shipper_address"], shipper.length > 2 ? shipper.at(-1) : "");
  const shipperPhone = fieldValueAny(data, ["shipper_phone"], phoneFromLines(shipper));
  setWorkbookCell(sheet, "C5", shipperCompany);
  setWorkbookCell(sheet, "C6", shipperContact);
  setWorkbookCell(sheet, "C7", shipperAddress);
  setWorkbookCell(sheet, "C12", String(shipperPhone || ""));
  sheet.getCell("C12").numFmt = "@";

  const consigneeCompany = fieldValueAny(data, ["consignee_company_name"], consignee[0] || "");
  const consigneeAddress = fieldValueAny(data, ["consignee_address"], consignee[1] || "");
  const consigneeContact = fieldValueAny(data, ["consignee_contact"], consignee[2] || "");
  const consigneePhone = fieldValueAny(data, ["consignee_phone"], phoneFromLines(consignee));
  setWorkbookCell(sheet, "H5", consigneeCompany);
  setWorkbookCell(sheet, "H6", consigneeContact);
  setWorkbookCell(sheet, "H7", consigneeAddress);
  setWorkbookCell(sheet, "H12", String(consigneePhone || ""));
  sheet.getCell("H12").numFmt = "@";
  setWorkbookCell(sheet, "H13", fieldValue(data, "consignee_postcode", "/") || "/");
  setWorkbookCell(sheet, "K13", fieldValueAny(data, ["consignee_city"], "KUWAIT CITY"));
  const origin = fieldValueAny(data, ["origin_country"], "MADE IN CHINA");
  setWorkbookCell(sheet, "F14", originCountryDisplay(origin));
  setWorkbookCell(sheet, "F15", originCountryName(origin));
  setWorkbookCell(sheet, "J15", String(fieldValueAny(data, ["destination_country"], "KUWAIT")).toUpperCase());

  clearWorkbookRows(sheet, 18, lastItemRow, 1, 11);
  let totalAmount = 0;
  items.forEach((item, index) => {
    const row = 18 + index;
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const amount = quantity * unitPrice;
    setWorkbookCell(sheet, `B${row}`, [item.description_en, item.description_cn].filter(Boolean).join("\n"));
    setWorkbookCell(sheet, `E${row}`, String(item.hs_code || ""));
    sheet.getCell(`E${row}`).numFmt = "@";
    setWorkbookCell(sheet, `F${row}`, item.material || "");
    setWorkbookCell(sheet, `G${row}`, item.use || "");
    setWorkbookCell(sheet, `H${row}`, quantity);
    setWorkbookCell(sheet, `J${row}`, unitPrice);
    sheet.getCell(`K${row}`).value = { formula: `H${row}*J${row}`, result: amount };
    sheet.getCell(`K${row}`).numFmt = "#,##0.00";
    sheet.getRow(row).height = fedexWorkbookRowHeight(item.description_en, item.description_cn, item.material, item.use);
    totalAmount += amount;
  });
  const packages = fieldValueAny(data, ["total_packages"], data.totals?.packages || 1);
  setWorkbookCell(sheet, `F${totalRow}`, packages);
  sheet.getCell(`K${totalRow}`).value = { formula: `SUM(K18:K${17 + items.length})`, result: totalAmount };
  sheet.getCell(`K${totalRow}`).numFmt = "#,##0.00";
  workbook.calcProperties.calcMode = "auto";
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `${caseNo} Commercial Invoice.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  return anchor.download;
}

function setStatus(text) {
  qs("serverStatus").textContent = text;
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getField(name) {
  return state.current?.fields?.[name]?.value ?? "";
}

function setField(name, value) {
  if (!state.current.fields[name]) {
    state.current.fields[name] = { value: "", confidence: "manual", evidence: [] };
  }
  state.current.fields[name].value = value;
  state.current.fields[name].confidence = "manual";
}

function localDateParts(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    iso: `${year}-${month}-${day}`,
    compact: `${year.slice(-2)}${month}${day}`,
  };
}

function knownCompanyCode() {
  const detected = detectCompanyCode();
  return detected === "KL" ? "KL" : "FT";
}

function shipmentCode() {
  return state.current?.case?.shipment_type === "fedex" ? "02" : "01";
}

function inferDraftShipmentType(draft) {
  const explicit = String(firstDefined(draft.shipment_type, draft.case?.shipment_type, "")).toLowerCase();
  if (["fedex", "sea"].includes(explicit)) return explicit;
  if (String(draft.document_type || "").toLowerCase() === "fedex_commercial_invoice") return "fedex";
  const invoiceNo = String(firstDefined(
    valueFromDraftField(draft.fields?.invoice_no),
    valueFromDraftField(draft.shipment_groups?.[0]?.invoice_no),
    draft.case_no,
    "",
  )).toUpperCase();
  if (/^(FT|KL)02\d{8}$/.test(invoiceNo)) return "fedex";
  if (/^(FT|KL)01\d{8}$/.test(invoiceNo)) return "sea";
  const transport = String(firstDefined(valueFromDraftField(draft.fields?.transport), valueFromDraftField(draft.shipment_groups?.[0]?.transport), ""));
  if (/FEDEX|EXPRESS|COURIER/i.test(transport)) return "fedex";
  if ((draft.file_inventory || draft.files || []).some((file) => /fedex_source|fedex_invoice_source/i.test(String(file.category || file.classification?.category || "")))) return "fedex";
  return "sea";
}

function renderShipmentMode() {
  const type = state.current?.case?.shipment_type === "fedex" ? "fedex" : "sea";
  document.body.classList.toggle("shipment-fedex", type === "fedex");
  document.body.classList.toggle("shipment-sea", type === "sea");
  document.querySelectorAll("[data-shipment-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shipmentType === type);
  });
  qs("reconciliationPanel").hidden = type === "fedex";
  qs("itemsTabLabel").textContent = type === "fedex" ? "FedEx PI" : "PI";
  qs("exportButton").textContent = type === "fedex" ? "导出 FedEx PI" : "导出";
  qs("exportMenu").querySelectorAll("[data-export-kind]").forEach((button) => {
    button.hidden = type === "fedex" ? button.dataset.exportKind !== "fedex" : button.dataset.exportKind === "fedex";
  });
  const activeTab = document.querySelector(".tab.active");
  if (type === "fedex" && activeTab?.hasAttribute("data-sea-only")) openTab("fields");
}

function setShipmentType(type) {
  if (!state.current || !["sea", "fedex"].includes(type) || state.current.case?.shipment_type === type) return;
  if (type === "fedex" && (state.current.shipment_groups || []).length > 1) {
    window.alert("当前整理稿包含多个提单组，不能直接合并为一份 FedEx 发票。请先新建或导入独立 FedEx 整理稿。");
    return;
  }
  if (state.activeGroupIndex >= 0) syncCurrentGroup();
  state.current.case.shipment_type = type;
  state.current.shipment_type = type;
  state.current.document_type = type === "fedex" ? "fedex_commercial_invoice" : "sea_pipkg";
  state.current.fedex_invoice_output_count = type === "fedex" ? 1 : 0;
  state.current.pipkg_output_count = type === "fedex" ? 0 : Math.max(1, state.current.shipment_groups?.length || 1);
  state.current.si_output_count = type === "fedex" ? 0 : Math.max(1, state.current.shipment_groups?.length || 1);
  state.current.split_required = type === "sea" && (state.current.shipment_groups || []).length > 1;
  if (type === "fedex") {
    state.current.shipment_groups = [];
    state.activeGroupIndex = -1;
    state.current.active_group_id = "";
    setField("transport", "FEDEX");
    ensureFedexDefaultFields();
  } else {
    setField("transport", "BY SEA");
  }
  const currentNumber = String(getField("invoice_no") || "").toUpperCase();
  const match = currentNumber.match(/^(FT|KL)(01|02)(\d{6})(\d{2})$/);
  const nextNumber = match ? `${match[1]}${type === "fedex" ? "02" : "01"}${match[3]}${match[4]}` : nextDailyInvoiceNumber();
  setField("invoice_no", nextNumber);
  state.current.case.case_no = nextNumber;
  state.current.base_case_no = nextNumber;
  if (type === "fedex") applyFedexHsKnowledge(state.current);
  markDirty();
  renderAll();
  openTab("fields");
}

function storedInvoiceNumbers() {
  try {
    const stored = JSON.parse(window.localStorage.getItem("tradeDocInvoiceNumbers") || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function reserveInvoiceNumber(number) {
  try {
    const numbers = new Set(storedInvoiceNumbers());
    numbers.add(number);
    window.localStorage.setItem("tradeDocInvoiceNumbers", JSON.stringify([...numbers].slice(-500)));
  } catch {
    // The number still works for the current session when browser storage is unavailable.
  }
}

function nextDailyInvoiceNumber() {
  const prefix = `${knownCompanyCode()}${shipmentCode()}${localDateParts().compact}`;
  const candidates = [
    ...storedInvoiceNumbers(),
    ...(state.cases || []).flatMap((item) => [item.case_no, item.name]),
  ].filter((value) => String(value || "").startsWith(prefix));
  const maxSequence = candidates.reduce((max, value) => {
    const match = String(value).match(/(\d{2})$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const number = `${prefix}${String(maxSequence + 1).padStart(2, "0")}`;
  reserveInvoiceNumber(number);
  return number;
}

function ensureDefaultInvoiceFields() {
  if (!state.current) return;
  if (!state.current.fields) state.current.fields = {};
  const existing = String(getField("invoice_no") || "").trim().toUpperCase();
  if (!invoiceNumberPattern.test(existing)) {
    const generated = nextDailyInvoiceNumber();
    state.current.fields.invoice_no = {
      value: generated,
      confidence: "manual",
      generated: true,
      evidence: [{ file: "default_naming_rule", locator: "current_date", text: "按公司、运输方式、当日日期和当日序号生成" }],
    };
    state.current.case.case_no = generated;
    state.current.base_case_no = generated;
  } else {
    reserveInvoiceNumber(existing);
    state.current.case.case_no = existing;
    if (!state.current.base_case_no) state.current.base_case_no = existing;
  }
  if (!getField("invoice_date")) {
    state.current.fields.invoice_date = {
      value: localDateParts().iso,
      confidence: "manual",
      evidence: [{ file: "default_naming_rule", locator: "current_date", text: "默认使用填表日期" }],
    };
  }
  if (state.current.case?.shipment_type === "fedex") ensureFedexDefaultFields();
}

function ensureFedexDefaultFields() {
  if (!state.current || state.current.case?.shipment_type !== "fedex") return;
  const defaults = {
    destination_country: "KUWAIT",
    consignee_city: "KUWAIT CITY",
    total_packages: 1,
  };
  const origin = String(getField("origin_country") || "").trim();
  if (!origin || origin.toUpperCase() === "CHINA") {
    state.current.fields.origin_country = {
      value: "MADE IN CHINA",
      confidence: "medium",
      evidence: [{ file: "default_rule", locator: "origin_country", text: "FedEx 默认原产地" }],
    };
  }
  Object.entries(defaults).forEach(([name, value]) => {
    if (getField(name) !== "" && getField(name) !== null && getField(name) !== undefined) return;
    state.current.fields[name] = {
      value,
      confidence: "medium",
      evidence: [{ file: "default_rule", locator: name, text: "FedEx 项目默认值，可人工修改" }],
    };
  });
}

function partyBlock(party) {
  return [party.company, party.address, party.contact, party.email].filter(Boolean).join("\n");
}

function companyByCode(code) {
  return state.knowledge.companies.find((item) => item.code === code);
}

function consigneeByCode(code) {
  return state.knowledge.consignees.find((item) => item.code === code);
}

function partyCodeForBlock(type, value) {
  const parties = type === "shipper" ? state.knowledge.companies : state.knowledge.consignees;
  const block = String(value || "").toUpperCase();
  const matched = parties.find((item) => block.includes(String(item.company || "").toUpperCase()));
  return matched?.code || "CUSTOM";
}

function detectCompanyCode() {
  const stored = getField("shipper_code");
  if (stored === "CUSTOM") return "CUSTOM";
  if (companyByCode(stored)) return stored;
  const block = String(getField("shipper_block") || getField("shipper_company")).toUpperCase();
  const matched = state.knowledge.companies.find((item) => block.includes(item.company.toUpperCase()));
  return matched?.code || "CUSTOM";
}

function detectConsigneeCode() {
  const stored = getField("consignee_code");
  if (stored === "CUSTOM") return "CUSTOM";
  if (consigneeByCode(stored)) return stored;
  const block = String(getField("consignee_company")).toUpperCase();
  const matched = state.knowledge.consignees.find((item) => block.includes(item.company.toUpperCase()));
  return matched?.code || "CUSTOM";
}

function renderOptions(items, selectedCode) {
  const options = items
    .map((item) => `<option value="${item.code}" ${item.code === selectedCode ? "selected" : ""}>${item.keyword}</option>`)
    .join("");
  return `${options}<option value="CUSTOM" ${selectedCode === "CUSTOM" ? "selected" : ""}>自填</option>`;
}

function renderChoiceControl(name, value) {
  const choices = fieldChoices[name] || [];
  const selected = choices.includes(String(value || "")) ? value : "CUSTOM";
  const options = choices
    .map((choice) => `<option value="${choice}" ${choice === selected ? "selected" : ""}>${choice}</option>`)
    .join("");
  return `
    <div class="choice-control">
      <select data-choice-select="${name}">
        ${options}
        <option value="CUSTOM" ${selected === "CUSTOM" ? "selected" : ""}>自定义</option>
      </select>
      <input data-field="${name}" data-choice-input="${name}" value="${value || ""}" />
    </div>
  `;
}

function evidenceText(field) {
  const evidence = field?.evidence?.[0];
  if (!evidence) return "人工录入或默认规则";
  return `${evidence.file} · ${evidence.locator}`;
}

function renderCases() {
  const list = qs("caseList");
  list.innerHTML = "";
  state.cases.forEach((item) => {
    const div = document.createElement("div");
    div.className = "case-card" + (state.current?.folder === item.path ? " active" : "");
    div.innerHTML = `
      <div class="card-title">
        <span>${item.name}</span>
        <span class="tag">${item.shipment_type || "unknown"}</span>
      </div>
      <div class="card-meta">${item.company_name || "未识别公司"} · ${item.date || "日期未识别"}</div>
    `;
    div.addEventListener("click", () => {
      qs("folderInput").value = item.path;
      scanFolder(item.path);
    });
    list.appendChild(div);
  });
}

function renderFiles() {
  const list = qs("fileList");
  list.innerHTML = "";
  const groups = groupFilesByDisplayCategory(state.current?.files || []);
  Object.entries(groups).forEach(([label, files]) => {
    const details = document.createElement("details");
    details.className = "file-group";
    details.open = false;
    details.innerHTML = `
      <summary>
        <span>${label}</span>
        <span class="tag">${files.length}</span>
      </summary>
      <div class="file-links">
        ${files
          .map((file) => `
            <a href="${file.source_url}" target="_blank" rel="noreferrer">
              <span>${file.name}</span>
              ${file.bill_of_lading_candidates?.length ? `<small>${file.bill_of_lading_candidates.join(", ")}</small>` : ""}
            </a>
          `)
          .join("")}
      </div>
    `;
    list.appendChild(details);
  });
}

function displayCategory(file) {
  if (file.bill_of_lading_candidates?.length || file.classification.category === "bill_of_lading") return "提单";
  if (["fedex_invoice_source", "fedex_source"].includes(file.classification.category)) return "FedEx";
  if (file.classification.category === "packing") return "装箱单";
  if (["supplier_pi", "sales_contract"].includes(file.classification.category)) return "货单";
  if (file.classification.category === "customer_info") return "客户资料";
  if (file.classification.category === "needs_ocr_review") return "待识别";
  return "其他";
}

function groupFilesByDisplayCategory(files) {
  return files.reduce((acc, file) => {
    const label = displayCategory(file);
    if (!acc[label]) acc[label] = [];
    acc[label].push(file);
    return acc;
  }, {});
}

function renderSummary() {
  const summary = qs("caseSummary");
  const data = state.current;
  if (!data) {
    summary.innerHTML = "";
    return;
  }
  const totalAmount = (data.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalPackages = data.case?.shipment_type === "fedex"
    ? Number(fieldValue(data, "total_packages", data.totals?.packages || 0))
    : (data.packing_lines || []).reduce((sum, item) => sum + Number(item.packages || 0), 0);
  const groupCount = (data.shipment_groups || []).length || 1;
  const cards = [
    ["单号", data.case.case_no],
    ["类型", data.case.shipment_type === "fedex" ? "FedEx" : "海运柜"],
    ["文件", `${data.files.length} 个`],
    [data.case.shipment_type === "fedex" ? "输出" : "提单组", data.case.shipment_type === "fedex" ? "Commercial Invoice" : `${groupCount} 组`],
    ["金额", `USD ${money(totalAmount)}`],
    ["商品", `${data.items.length} 行`],
    [data.case.shipment_type === "fedex" ? "包裹" : "箱数", totalPackages || "待补"],
    ["问题", `${data.issues.length} 个`],
    ["状态", data.issues.some((i) => i.level === "error") ? "待处理" : "可导出"],
  ];
  summary.innerHTML = cards
    .map((card) => `
      <div class="summary-item">
        <div class="summary-label">${card[0]}</div>
        <div class="summary-value">${card[1] || "-"}</div>
      </div>
    `)
    .join("");
}

function renderFields() {
  const grid = qs("fieldGrid");
  if (!state.current) {
    grid.innerHTML = "";
    return;
  }
  const visibleFields = state.current.case?.shipment_type === "fedex" ? fedexFields : seaFields;
  grid.innerHTML = visibleFields
    .map((name) => {
      const field = state.current.fields[name] || { value: "", confidence: "low", evidence: [] };
      const multiline = ["shipper_block", "consignee_company"].includes(name);
      let input = multiline
        ? `<textarea data-field="${name}">${field.value || ""}</textarea>`
        : `<input data-field="${name}" value="${field.value || ""}" />`;
      if (name === "shipper_block") {
        input = `
          <div class="field-control">
            <select data-party-select="shipper">${renderOptions(state.knowledge.companies, detectCompanyCode())}</select>
            <textarea data-field="${name}">${field.value || ""}</textarea>
          </div>
        `;
      }
      if (name === "consignee_company") {
        input = `
          <div class="field-control">
            <select data-party-select="consignee">${renderOptions(state.knowledge.consignees, detectConsigneeCode())}</select>
            <textarea data-field="${name}">${field.value || ""}</textarea>
          </div>
        `;
      }
      if (fieldChoices[name]) {
        input = renderChoiceControl(name, field.value);
      }
      return `
        <div class="field-box">
          <label>
            <span>${fieldLabels[name] || name}</span>
            <span class="tag ${field.confidence}">${field.confidence}</span>
          </label>
          ${input}
        </div>
      `;
    })
    .join("");
  grid.querySelectorAll("[data-party-select]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const type = event.target.dataset.partySelect;
      const code = event.target.value;
      if (type === "shipper") {
        setField("shipper_code", code);
        const item = companyByCode(code);
        if (item) {
          setField("shipper_block", item.block);
          setField("shipper_company", item.company);
          setField("shipper_address", item.address);
          setField("shipper_contact", item.contact);
        }
      }
      if (type === "consignee") {
        setField("consignee_code", code);
        const item = consigneeByCode(code);
        if (item) {
          setField("consignee_company", partyBlock(item));
        }
      }
      markDirty();
      renderFields();
      renderSummary();
      if (code === "CUSTOM") {
        window.requestAnimationFrame(() => {
          grid.querySelector(`[data-party-select="${type}"]`)?.closest(".field-control")?.querySelector("textarea")?.focus();
        });
      }
    });
  });
  grid.querySelectorAll("[data-choice-select]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const name = event.target.dataset.choiceSelect;
      const input = grid.querySelector(`[data-choice-input="${name}"]`);
      if (event.target.value !== "CUSTOM") {
        setField(name, event.target.value);
        if (input) input.value = event.target.value;
      }
      markDirty();
      input?.focus();
      renderSummary();
    });
  });
  grid.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const name = event.target.dataset.field;
      setField(name, event.target.value);
      if (name === "shipper_block") {
        setField("shipper_code", "CUSTOM");
        const select = grid.querySelector('[data-party-select="shipper"]');
        if (select) select.value = "CUSTOM";
      }
      if (name === "consignee_company") {
        setField("consignee_code", "CUSTOM");
        const select = grid.querySelector('[data-party-select="consignee"]');
        if (select) select.value = "CUSTOM";
      }
      if (fieldChoices[name]) {
        const choice = (fieldChoices[name] || []).includes(event.target.value) ? event.target.value : "CUSTOM";
        const select = grid.querySelector(`[data-choice-select="${name}"]`);
        if (select) select.value = choice;
      }
      markDirty();
      renderSummary();
    });
  });
}

function renderSiFields() {
  const grid = qs("siGrid");
  if (!state.current) {
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = siFields
    .map((name) => {
      const field = state.current.fields[name] || { value: name === "si_template" ? "MSC" : "", confidence: "manual", evidence: [] };
      let input = `<input data-field="${name}" value="${field.value || ""}" />`;
      if (name === "si_template") {
        input = `
          <select data-field="${name}">
            <option value="MSC" ${field.value === "MSC" || !field.value ? "selected" : ""}>MSC</option>
            <option value="CMA" ${field.value === "CMA" ? "selected" : ""}>CMA</option>
            <option value="COSCO" ${field.value === "COSCO" ? "selected" : ""}>COSCO</option>
            <option value="CUSTOM" ${field.value === "CUSTOM" ? "selected" : ""}>自填</option>
          </select>
        `;
      }
      return `
        <div class="field-box">
          <label>
            <span>${fieldLabels[name] || name}</span>
            <span class="tag ${field.confidence}">${field.confidence}</span>
          </label>
          ${input}
        </div>
      `;
    })
    .join("");
  grid.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      setField(event.target.dataset.field, event.target.value);
      markDirty();
      renderSummary();
    });
    input.addEventListener("change", (event) => {
      setField(event.target.dataset.field, event.target.value);
      markDirty();
      renderSummary();
    });
  });
}

function editableCell(value, key, rowIndex, tableName, textarea = false) {
  const escaped = escapeHtml(value ?? "");
  if (textarea) {
    return `<textarea data-table="${tableName}" data-row="${rowIndex}" data-key="${key}">${escaped}</textarea>`;
  }
  return `<input data-table="${tableName}" data-row="${rowIndex}" data-key="${key}" value="${escaped}" />`;
}

function normalizedFieldRecommendation(item, key) {
  const raw = item.field_recommendations?.[key] || item.recommendations?.[key] || {};
  const alternatives = (raw.alternatives || raw.options || [])
    .map((option) => typeof option === "string" ? { value: option } : option || {})
    .filter((option) => String(option.value || "").trim());
  return {
    ...raw,
    recommended: String(raw.recommended || raw.value || "").trim(),
    alternatives,
  };
}

function itemRecommendationCell(item, key, index) {
  const recommendation = normalizedFieldRecommendation(item, key);
  const current = String(item[key] || recommendation.recommended || "").trim();
  const alternatives = recommendation.alternatives.filter((option) => option.value !== current);
  return `
    <div class="item-recommendation-cell">
      ${editableCell(current, key, index, "items", true)}
      ${alternatives.length ? `
        <details class="item-recommendation-options">
          <summary>备选 ${alternatives.length}</summary>
          <div class="item-recommendation-list">
            ${alternatives.map((option) => `
              <button type="button" data-item-recommendation-row="${index}" data-item-recommendation-key="${key}" data-item-recommendation-value="${escapeHtml(option.value)}">
                <strong>${escapeHtml(option.value)}</strong>
                ${option.reason ? `<span>${escapeHtml(option.reason)}</span>` : ""}
              </button>
            `).join("")}
          </div>
        </details>
      ` : ""}
    </div>
  `;
}

function bindTableInputs(tableName) {
  document.querySelectorAll(`[data-table="${tableName}"]`).forEach((input) => {
    input.addEventListener("input", (event) => {
      const row = Number(event.target.dataset.row);
      const key = event.target.dataset.key;
      state.current[tableName][row][key] = event.target.value;
      if (tableName === "items" && ["material", "use"].includes(key)) {
        const item = state.current.items[row];
        item.field_recommendations = item.field_recommendations || {};
        item.field_recommendations[key] = {
          ...normalizedFieldRecommendation(item, key),
          selected: event.target.value,
          status: "manual",
        };
      }
      if (tableName === "items" && ["quantity", "unit_price"].includes(key)) {
        const item = state.current.items[row];
        if (key === "unit_price") {
          item.unit_price_method = "manual";
          item.price_confirmed = true;
        }
        item.amount = Number(item.quantity || 0) * Number(item.unit_price || 0);
        const amountInput = document.querySelector(`[data-table="items"][data-row="${row}"][data-key="amount"]`);
        if (amountInput && document.activeElement !== amountInput) {
          amountInput.value = item.amount ? Number(item.amount.toFixed(2)) : "";
        }
        renderPriceSummary();
      }
      if (tableName === "items" && key === "amount") {
        renderPriceSummary();
      }
      if (tableName === "items" && key === "hs_code" && state.current.case?.shipment_type === "fedex") {
        const item = state.current.items[row];
        item.hs_code_reference = {
          ...(item.hs_code_reference || {}),
          status: event.target.value ? "manual_pending" : "unresolved",
          suggested_hs_code: event.target.value,
          normalized_hs_code: normalizeHsCode(event.target.value),
          confidence: event.target.value ? "medium" : "low",
          needs_confirmation: true,
        };
      }
      if (tableName === "packing_lines" && ["gross_weight", "cbm"].includes(key)) {
        delete state.current.packing_reconciliation?.[key];
        renderReconciliation();
      }
      markDirty();
      renderSummary();
    });
    input.addEventListener("change", (event) => {
      if (tableName !== "items" || state.current.case?.shipment_type !== "fedex") return;
      if (event.target.dataset.key === "hs_code") {
        renderItems();
        return;
      }
      if (!["description_en", "description_cn", "material", "use"].includes(event.target.dataset.key)) return;
      const row = Number(event.target.dataset.row);
      const item = state.current.items[row];
      const importedCandidates = uniqueHsCandidates(item.hs_code_reference?.candidate_codes || []);
      if (
        !["browser_confirmed", "source_explicit"].includes(item.hs_code_reference?.status)
        && !importedCandidates.length
      ) {
        item.hs_code_reference = matchFedexHsKnowledge(item, getField("destination_country"));
        if (!item.hs_code && item.hs_code_reference.status === "confirmed_exact") item.hs_code = item.hs_code_reference.suggested_hs_code;
      }
      renderItems();
    });
  });
}

function priceCell(item, index) {
  const input = editableCell(item.unit_price, "unit_price", index, "items");
  if (item.unit_price_method !== "ai_estimate") return input;
  return `
    <div class="price-review">
      ${input}
      <small>${escapeHtml(item.unit_price_basis || "AI 估价，整票估价上限 USD 80")}</small>
      <label><input type="checkbox" data-price-confirm-row="${index}" ${item.price_confirmed ? "checked" : ""} />已核验价格</label>
    </div>
  `;
}

function hsReferenceCell(item, index) {
  const reference = item.hs_code_reference || { status: "unresolved", needs_confirmation: true };
  const labels = {
    source_explicit: "来源文件",
    confirmed_exact: "正式参考",
    candidate: "候选",
    manual_pending: "待确认",
    browser_confirmed: "已确认",
    rejected: "已拒绝",
    unresolved: "未匹配",
  };
  const status = reference.status || "unresolved";
  const candidates = uniqueHsCandidates(reference.candidate_codes || []);
  const hasConflict = candidates.length > 1 && reference.needs_confirmation !== false;
  const conflictPending = hasConflict && status !== "browser_confirmed";
  const suggested = reference.suggested_hs_code || candidates[0]?.hs_code || item.hs_code || "";
  const tone = conflictPending ? "low" : reference.needs_confirmation ? "warning" : ["rejected", "unresolved"].includes(status) ? "low" : "high";
  const sourceText = conflictPending
    ? `检测到 ${candidates.length} 个参考编码，请人工选择`
    : candidates.length === 1
    ? candidates[0].source_label || candidates[0].source || "候选参考"
    : reference.knowledge_id
    ? `${reference.knowledge_id}${reference.source_count ? ` · ${reference.source_count} 次来源` : ""}`
    : status === "source_explicit" ? "本次来源文件" : "暂无可靠参考";
  const canConfirm = !conflictPending && Boolean(normalizeHsCode(item.hs_code || suggested)) && !["source_explicit", "confirmed_exact", "browser_confirmed"].includes(status);
  return `
    <div class="hs-reference">
      <div class="hs-reference-title"><span class="tag ${tone}">${conflictPending ? "编码冲突" : labels[status] || status}</span>${!conflictPending && suggested ? `<strong>${escapeHtml(suggested)}</strong>` : ""}</div>
      <small>${escapeHtml(sourceText)}</small>
      ${conflictPending ? `
        <div class="hs-conflict-options" role="group" aria-label="选择第 ${index + 1} 行商品 HS Code">
          ${candidates.map((candidate, candidateIndex) => `
            <div class="hs-conflict-option">
              <button type="button" class="hs-conflict-code-button" data-select-hs-row="${index}" data-select-hs-code="${candidate.normalized_hs_code}">
                <strong>${escapeHtml(candidate.hs_code)}${candidateIndex === 0 ? " · 推荐" : ""}</strong>
                <span>${escapeHtml(candidate.description_cn || candidate.description_en || candidate.source_label || candidate.source || "参考来源")}</span>
              </button>
              ${candidate.official_url ? `<a href="${escapeHtml(candidate.official_url)}" target="_blank" rel="noreferrer">查看官方来源</a>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div class="hs-reference-actions">
        ${canConfirm ? `<button type="button" data-confirm-hs-row="${index}">${item.hs_code ? "确认当前" : "采用并确认"}</button>` : ""}
        ${status === "candidate" ? `<button type="button" class="reject-reference" data-reject-hs-row="${index}">不采用</button>` : ""}
      </div>
    </div>
  `;
}

function deleteTableRow(tableName, rowIndex) {
  if (!state.current?.[tableName]?.[rowIndex]) return;
  state.current[tableName].splice(rowIndex, 1);
  reconcileIssuesAfterRowDelete(tableName, rowIndex);
  markDirty();
  if (tableName === "items") {
    renderItems();
  } else {
    renderPacking();
  }
  renderReconciliation();
  renderSummary();
  renderIssues();
}

function reconcileIssuesAfterRowDelete(tableName, deletedIndex) {
  const prefix = `${tableName}[`;
  state.current.issues = (state.current.issues || []).flatMap((issue) => {
    const fieldName = String(issue.field || "");
    if (!fieldName.startsWith(prefix)) return [issue];
    const match = fieldName.match(new RegExp(`^${tableName}\\[(\\d+)\\](.*)$`));
    if (!match) return [issue];
    const issueIndex = Number(match[1]);
    if (issueIndex === deletedIndex) return [];
    if (issueIndex < deletedIndex) return [issue];
    return [{ ...issue, field: `${tableName}[${issueIndex - 1}]${match[2]}` }];
  });
}

function bindDeleteRows(tableName) {
  document.querySelectorAll(`[data-delete-table="${tableName}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      deleteTableRow(tableName, Number(button.dataset.deleteRow));
    });
  });
}

async function selectItemFieldRecommendation(rowIndex, key, value) {
  const item = state.current?.items?.[rowIndex];
  if (!item || !["material", "use"].includes(key)) return;
  item[key] = value;
  item.field_recommendations = item.field_recommendations || {};
  item.field_recommendations[key] = {
    ...normalizedFieldRecommendation(item, key),
    selected: value,
    status: "browser_selected",
    selected_at: new Date().toISOString(),
  };
  const reference = item.hs_code_reference || {};
  const importedCandidates = uniqueHsCandidates(reference.candidate_codes || []);
  if (
    state.current.case?.shipment_type === "fedex"
    && !["browser_confirmed", "source_explicit"].includes(reference.status)
    && !importedCandidates.length
  ) {
    item.hs_code_reference = matchFedexHsKnowledge(item, getField("destination_country"));
    if (!item.hs_code && item.hs_code_reference.status === "confirmed_exact") {
      item.hs_code = item.hs_code_reference.suggested_hs_code;
    }
  }
  state.current = validateInBrowser(state.current);
  markDirty();
  renderItems();
  renderSummary();
  renderIssues();
  await persistCurrentDraft();
}

function renderItems() {
  const tbody = qs("itemsTable").querySelector("tbody");
  tbody.innerHTML = (state.current?.items || [])
    .map((item, index) => `
      <tr>
        <td>${editableCell(item.description_en, "description_en", index, "items", true)}</td>
        <td>${editableCell(item.description_cn, "description_cn", index, "items")}</td>
        <td>${priceCell(item, index)}</td>
        <td>${editableCell(item.quantity, "quantity", index, "items")}</td>
        <td>${editableCell(item.unit, "unit", index, "items")}</td>
        <td>${editableCell(item.amount, "amount", index, "items")}</td>
        <td>${editableCell(item.hs_code, "hs_code", index, "items")}</td>
        <td data-fedex-only>${itemRecommendationCell(item, "material", index)}</td>
        <td data-fedex-only>${itemRecommendationCell(item, "use", index)}</td>
        <td>${escapeHtml(item.source || "manual")}</td>
        <td data-fedex-only class="hs-reference-cell">${hsReferenceCell(item, index)}</td>
        <td class="row-action-cell">
          <button type="button" class="row-delete-button" data-delete-table="items" data-delete-row="${index}" title="删除此商品行" aria-label="删除第 ${index + 1} 个商品行">×</button>
        </td>
      </tr>
    `)
    .join("");
  bindTableInputs("items");
  bindDeleteRows("items");
  tbody.querySelectorAll("[data-confirm-hs-row]").forEach((button) => {
    button.addEventListener("click", () => confirmHsReference(Number(button.dataset.confirmHsRow)));
  });
  tbody.querySelectorAll("[data-select-hs-row]").forEach((button) => {
    button.addEventListener("click", () => confirmHsReference(
      Number(button.dataset.selectHsRow),
      button.dataset.selectHsCode,
    ));
  });
  tbody.querySelectorAll("[data-reject-hs-row]").forEach((button) => {
    button.addEventListener("click", () => rejectHsReference(Number(button.dataset.rejectHsRow)));
  });
  tbody.querySelectorAll("[data-item-recommendation-row]").forEach((button) => {
    button.addEventListener("click", () => selectItemFieldRecommendation(
      Number(button.dataset.itemRecommendationRow),
      button.dataset.itemRecommendationKey,
      button.dataset.itemRecommendationValue,
    ));
  });
  tbody.querySelectorAll("[data-price-confirm-row]").forEach((input) => {
    input.addEventListener("change", () => {
      state.current.items[Number(input.dataset.priceConfirmRow)].price_confirmed = input.checked;
      state.current = validateInBrowser(state.current);
      markDirty();
      renderSummary();
      renderIssues();
    });
  });
  renderPriceSummary();
}

function renderPriceSummary() {
  const table = qs("itemsTable");
  const existing = document.querySelector(".price-summary");
  if (existing) existing.remove();
  const total = (state.current?.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const div = document.createElement("div");
  div.className = "price-summary";
  div.innerHTML = `<span>总价</span><strong>USD ${money(total)}</strong>`;
  table.closest(".table-wrap").after(div);
}

function renderPacking() {
  const tbody = qs("packingTable").querySelector("tbody");
  tbody.innerHTML = (state.current?.packing_lines || [])
    .map((line, index) => `
      <tr>
        <td>${editableCell(line.description_en, "description_en", index, "packing_lines", true)}</td>
        <td>${editableCell(line.quantity, "quantity", index, "packing_lines")}</td>
        <td>${editableCell(line.unit, "unit", index, "packing_lines")}</td>
        <td>${editableCell(line.packages, "packages", index, "packing_lines")}</td>
        <td>${editableCell(line.gross_weight, "gross_weight", index, "packing_lines")}</td>
        <td>${editableCell(line.net_weight, "net_weight", index, "packing_lines")}</td>
        <td>${editableCell(line.cbm, "cbm", index, "packing_lines")}</td>
        <td>${editableCell(line.hs_code, "hs_code", index, "packing_lines")}</td>
        <td class="row-action-cell">
          <button type="button" class="row-delete-button" data-delete-table="packing_lines" data-delete-row="${index}" title="删除此包装行" aria-label="删除第 ${index + 1} 个包装行">×</button>
        </td>
      </tr>
    `)
    .join("");
  bindTableInputs("packing_lines");
  bindDeleteRows("packing_lines");
}

function recalculateCurrent() {
  if (!state.current) return;
  state.current.items.forEach((item) => {
    item.amount = Number(item.quantity || 0) * Number(item.unit_price || 0);
  });
  state.current.packing_lines.forEach((line) => {
    const quantity = Number(line.quantity || 0);
    const desc = String(line.description_en || "");
    const thicknessMatch = desc.match(/(\d+(?:\.\d+)?)\s*mm/i) || desc.match(/(\d+(?:\.\d+)?)\s*\*/);
    if (quantity && normalizeQuantityUnit(line.unit) === "SQM" && thicknessMatch && !Number(line.gross_weight || 0)) {
      const estimate = quantity * Number(thicknessMatch[1]) * 2.5;
      line.gross_weight = Number(estimate.toFixed(1));
    }
    if ((line.net_weight === null || line.net_weight === "" || line.net_weight === undefined) && Number(line.gross_weight || 0) > 0) {
      line.net_weight = Number((Number(line.gross_weight) * 0.9).toFixed(3));
      line.net_weight_method = "default_90_percent_of_gross";
    }
  });
  reconcilePackingTotals(state.current, true);
  renderItems();
  renderPacking();
  renderSummary();
  renderReconciliation();
}

function reconciliationSnapshot(data, key) {
  const target = sourceTotalNumber(data?.bl_totals, key);
  if (target === null) return null;
  const currentTotal = (data.packing_lines || []).reduce((sum, line) => sum + Number(line[key] || 0), 0);
  const saved = data.packing_reconciliation?.[key];
  if (saved?.status === "adjusted" && Math.abs(currentTotal - target) < 1e-9) return saved;
  const difference = target - currentTotal;
  const absoluteDifference = Math.abs(difference);
  const tolerance = reconciliationTolerance(key, target);
  return {
    status: absoluteDifference < 1e-9 ? "matched" : absoluteDifference <= tolerance ? "within_tolerance" : "anomaly",
    unit: key === "gross_weight" ? "KGS" : "CBM",
    detail_total_before: currentTotal,
    detail_total_after: currentTotal,
    bill_total: target,
    difference,
    absolute_difference: absoluteDifference,
    error_rate_percent: target ? absoluteDifference / Math.abs(target) * 100 : 0,
    tolerance,
  };
}

function reconciliationNumber(value, decimals = 8) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function renderReconciliation() {
  const grid = qs("reconciliationGrid");
  if (!grid) return;
  if (!state.current) {
    grid.innerHTML = `<div class="reconciliation-empty">导入整理稿后显示毛重和体积核对。</div>`;
    return;
  }
  const labels = { gross_weight: "毛重", cbm: "体积" };
  const statusLabels = { matched: "一致", adjusted: "已平差", within_tolerance: "可平差", anomaly: "异常" };
  grid.innerHTML = ["gross_weight", "cbm"].map((key) => {
    const result = reconciliationSnapshot(state.current, key);
    if (!result) {
      return `<div class="reconciliation-card"><div class="card-title"><span>${labels[key]}</span><span class="tag medium">缺少提单值</span></div></div>`;
    }
    const display = state.current.bl_totals?.[`${key}_display`] || reconciliationNumber(result.bill_total);
    const statusClass = result.status === "anomaly" ? "error" : result.status === "adjusted" || result.status === "matched" ? "high" : "medium";
    return `
      <div class="reconciliation-card ${result.status === "anomaly" ? "error" : ""}">
        <div class="card-title"><span>${labels[key]}</span><span class="tag ${statusClass}">${statusLabels[result.status]}</span></div>
        <div class="reconciliation-values">
          <span>明细计算<strong>${reconciliationNumber(result.detail_total_before)} ${result.unit}</strong></span>
          <span>提单数值<strong>${display} ${result.unit}</strong></span>
          <span>绝对差值<strong>${reconciliationNumber(result.absolute_difference)} ${result.unit}</strong></span>
          <span>误差率<strong>${Number(result.error_rate_percent || 0).toFixed(4)}%</strong></span>
          ${result.status === "adjusted" ? `<span>平差后<strong>${reconciliationNumber(result.detail_total_after)} ${result.unit}</strong></span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderGroups() {
  const list = qs("groupList");
  if (!list || !state.current) return;
  const groups = state.current.shipment_groups || [];
  if (!groups.length) {
    list.innerHTML = `<div class="issue-card"><div class="card-title">未发现拆单标记</div><div class="card-meta">上传多个提单或导入 skill 整理稿后，这里会显示每个提单对应的 PIPKG/SI 输出。</div></div>`;
    return;
  }
  list.innerHTML = groups
    .map((group, index) => {
      const blNo = valueFromDraftField(group.bill_of_lading_no) || group.bill_of_lading_no || group.group_id;
      const containers = group.si?.containers || [];
      const itemCount = group.items?.length || 0;
      const packingCount = group.packing_lines?.length || 0;
      const status = group.allocation_status || group.status || "needs_review";
      const hasContainerData = containers.length > 0;
      const hasItemData = itemCount > 0;
      const hasPackingData = packingCount > 0;
      return `
        <div class="group-card ${index === state.activeGroupIndex ? "active" : ""}">
          <div class="card-title">
            <span>提单号：${blNo}</span>
            <span class="tag ${status === "complete" || status === "single_group" ? "high" : "warning"}">${status}</span>
          </div>
          <div class="group-meta">
            <span>PIPKG待核验</span>
            <span>SI模板未配置</span>
            ${hasContainerData ? `<span>柜子数：${containers.length}</span>` : ""}
            ${hasItemData ? `<span>商品数：${itemCount}</span>` : ""}
            ${hasPackingData ? `<span>包装行：${packingCount}</span>` : ""}
            ${!hasContainerData && !hasItemData && !hasPackingData ? `<span>待整理柜号和货品分配</span>` : ""}
          </div>
          ${containers.length ? `
            <div class="container-list">
              ${containers.map((container) => `
                <div>
                  <strong>${container.container_no || "柜号待识别"}</strong>
                  <span>${container.packages || 0} ${container.package_unit || "PKG"} · ${container.gross_weight || "-"} KGS · ${container.cbm || "-"} CBM</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
          <button data-load-group="${index}">加载此提单</button>
        </div>
      `;
    })
    .join("");
  list.querySelectorAll("[data-load-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.loadGroup);
      applyShipmentGroup(groups[index], index);
      openTab("fields");
    });
  });
}

function renderIssues() {
  const list = qs("issueList");
  const issues = state.current?.issues || [];
  qs("issueCount").textContent = issues.length;
  if (!issues.length) {
    list.innerHTML = `<div class="issue-card"><div class="card-title">未发现阻塞问题</div><div class="card-meta">仍建议核对来源文件后导出。</div></div>`;
    return;
  }
  list.innerHTML = issues
    .map((issue, index) => `
      <button type="button" class="issue-card issue-link ${issue.level}" data-issue-index="${index}" title="跳转到问题位置">
        <div class="card-title">
          <span>${issue.type}</span>
          <span class="tag ${issue.level}">${issue.level}</span>
        </div>
        <div class="card-meta">${issue.message}</div>
      </button>
    `)
    .join("");
  list.querySelectorAll("[data-issue-index]").forEach((card) => {
    card.addEventListener("click", () => {
      navigateToIssue(issues[Number(card.dataset.issueIndex)]);
    });
  });
}

function normalizedIssueField(fieldName) {
  const aliases = {
    consignee_block: "consignee_company",
  };
  const normalized = String(fieldName || "").replace(/__conflict$/, "");
  return aliases[normalized] || normalized;
}

function issueTab(issue) {
  const rawFieldName = String(issue?.field || "");
  const fieldName = normalizedIssueField(rawFieldName);
  const issueType = String(issue?.type || "");
  if (fieldName.startsWith("items") || issueType === "missing_items" || issueType === "amount_mismatch") return "items";
  if (fieldName.startsWith("packing_lines") || issueType.startsWith("missing_packing") || issueType.endsWith("_anomaly")) return "packing";
  if (["shipment_groups", "assigned_sources", "active_group_id"].includes(fieldName) || issueType === "multiple_bill_of_lading") return "groups";
  if (siFields.includes(fieldName) || fieldName.startsWith("si.")) return "si";
  if ([...seaFields, ...fedexFields].includes(fieldName) || rawFieldName.endsWith("__conflict")) return "fields";
  return "groups";
}

function issueTarget(issue, tabName) {
  if (String(issue?.type || "").endsWith("_anomaly")) {
    qs("reconciliationPanel").open = true;
    return qs("reconciliationPanel");
  }
  const fieldName = normalizedIssueField(issue?.field);
  const tableName = tabName === "items" ? "items" : tabName === "packing" ? "packing_lines" : "";
  if (tableName) {
    const rowMatch = fieldName.match(/\[(\d+)/);
    const rowIndex = rowMatch ? Number(rowMatch[1]) : 0;
    const keyMatch = fieldName.match(/\]\.(\w+)/);
    const key = keyMatch?.[1];
    if (key && !["container_breakdown"].includes(key)) {
      const input = document.querySelector(`[data-table="${tableName}"][data-row="${rowIndex}"][data-key="${key}"]`);
      if (input) return input;
    }
    return document.querySelector(`#${tableName === "items" ? "itemsTable" : "packingTable"} tbody tr:nth-child(${rowIndex + 1})`)
      || qs(tableName === "items" ? "addItem" : "addPacking");
  }
  if (tabName === "fields" || tabName === "si") {
    const input = document.querySelector(`[data-field="${fieldName}"]`);
    return input;
  }
  if (tabName === "groups") {
    return document.querySelector(".group-card") || qs("groupList");
  }
  return qs(`tab-${tabName}`);
}

function navigateToIssue(issue) {
  const tabName = issueTab(issue);
  openTab(tabName);
  window.requestAnimationFrame(() => {
    document.querySelectorAll(".issue-target").forEach((element) => element.classList.remove("issue-target"));
    const target = issueTarget(issue, tabName);
    if (!target) return;
    const highlight = target.closest("tr, .field-box, .group-card") || target;
    highlight.classList.add("issue-target");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    if (target.matches("input, textarea, select, button")) target.focus({ preventScroll: true });
    window.setTimeout(() => highlight.classList.remove("issue-target"), 2400);
  });
}

function extractJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("整理稿内容为空");
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function valueFromDraftField(field) {
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function evidenceFromDraftField(field, fallback = "整理稿导入") {
  if (field && typeof field === "object" && Array.isArray(field.evidence)) return field.evidence;
  return [{ file: fallback, locator: "import", text: "" }];
}

function draftConfidence(field, fallback = "imported") {
  if (field && typeof field === "object" && field.confidence) return field.confidence;
  return fallback;
}

function fieldObjectFromDraft(field) {
  return {
    value: valueFromDraftField(field),
    confidence: draftConfidence(field),
    evidence: evidenceFromDraftField(field),
  };
}

function firstDraftField(container, names) {
  return names.map((name) => container?.[name]).find((field) => {
    const value = valueFromDraftField(field);
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function partyFieldFromDraft(container, prefix) {
  const block = firstDraftField(container, [`${prefix}_block`]);
  if (block) return block;
  const companyField = firstDraftField(container, [`${prefix}_company`, `${prefix}_name`]);
  if (String(valueFromDraftField(companyField) || "").includes("\n")) return companyField;
  const fields = [
    companyField,
    firstDraftField(container, [`${prefix}_address`]),
    firstDraftField(container, [`${prefix}_contact`, `${prefix}_contact_name`]),
    firstDraftField(container, [`${prefix}_phone`]),
    firstDraftField(container, [`${prefix}_email`]),
  ].filter(Boolean);
  const values = [...new Set(fields.map(valueFromDraftField).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!values.length) return undefined;
  return {
    value: values.join("\n"),
    confidence: fields.map((field) => draftConfidence(field, "imported")).find((value) => value === "low") || draftConfidence(fields[0]),
    evidence: fields.flatMap((field) => evidenceFromDraftField(field)),
  };
}

function invoiceNoForGroup(baseNo, index) {
  const text = String(baseNo || "");
  const match = text.match(/^(.*?)(\d{2})$/);
  if (!match) return text;
  return `${match[1]}${String(Number(match[2]) + index).padStart(2, "0")}`;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeQuantityUnit(unit) {
  const normalized = String(unit || "OTHER").trim().toUpperCase();
  if (["M", "METER", "METERS", "METRE", "METRES"].includes(normalized)) return "M";
  if (["PC", "PCS", "PIECE", "PIECES"].includes(normalized)) return "PCS";
  if (["PKG", "PKGS", "PACKAGE", "PACKAGES"].includes(normalized)) return "PKGS";
  return normalized || "OTHER";
}

function draftNumber(value, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function draftNumberOrBlank(...values) {
  const value = firstDefined(...values);
  return value === undefined ? "" : draftNumber(value, "");
}

function normalizeDraftTotals(totals = {}, containers = []) {
  const containerPackages = containers.reduce((sum, row) => sum + draftNumber(valueFromDraftField(row.packages), 0), 0);
  const containerGross = containers.reduce((sum, row) => sum + draftNumber(valueFromDraftField(row.gross_weight), 0), 0);
  const containerCbm = containers.reduce((sum, row) => sum + draftNumber(valueFromDraftField(row.cbm), 0), 0);
  const grossRaw = firstDefined(valueFromDraftField(totals.gross_weight), containerGross || undefined);
  const cbmRaw = firstDefined(valueFromDraftField(totals.cbm), containerCbm || undefined);
  return {
    packages: draftNumber(firstDefined(valueFromDraftField(totals.packages), containerPackages), 0),
    gross_weight: grossRaw === undefined ? null : draftNumber(grossRaw, null),
    gross_weight_display: String(firstDefined(valueFromDraftField(totals.gross_weight_display), valueFromDraftField(containers[0]?.gross_weight_display), typeof grossRaw === "string" ? grossRaw : "") || ""),
    cbm: cbmRaw === undefined ? null : draftNumber(cbmRaw, null),
    cbm_display: String(firstDefined(valueFromDraftField(totals.cbm_display), valueFromDraftField(containers[0]?.cbm_display), typeof cbmRaw === "string" ? cbmRaw : "") || ""),
    source: totals.source || totals.totals_source || "bill_of_lading",
  };
}

function normalizeDraftQuantity(record) {
  const sourceQuantity = draftNumber(firstDefined(record.quantity_source, record.source_quantity, record.quantity, 0));
  const sourceUnit = normalizeQuantityUnit(firstDefined(record.quantity_source_unit, record.source_unit, record.unit));
  const pieceLength = draftNumber(firstDefined(record.piece_length_m, record.length_per_piece_m, 0));
  const explicitQuantity = firstDefined(record.pipkg_quantity, record.piece_count_calculated);
  let quantity = explicitQuantity === undefined ? sourceQuantity : draftNumber(explicitQuantity);
  let unit = normalizeQuantityUnit(firstDefined(record.pipkg_quantity_unit, explicitQuantity !== undefined ? "PCS" : sourceUnit));
  if (explicitQuantity === undefined && sourceUnit === "M" && pieceLength > 0) {
    quantity = Number((sourceQuantity / pieceLength).toFixed(6));
    unit = "PCS";
  }
  const convertedMetersToPieces = sourceUnit === "M" && unit === "PCS" && pieceLength > 0;
  const sourceUnitPrice = draftNumber(firstDefined(record.unit_price_source, record.source_unit_price, record.unit_price, 0));
  let unitPrice = draftNumber(firstDefined(record.pipkg_unit_price, sourceUnitPrice));
  if (convertedMetersToPieces && record.pipkg_unit_price === undefined && sourceUnitPrice) {
    unitPrice = Number((sourceUnitPrice * pieceLength).toFixed(6));
  }
  return {
    quantity,
    unit,
    unitPrice,
    quantity_source: sourceQuantity,
    quantity_source_unit: sourceUnit,
    piece_length_m: pieceLength || null,
    piece_count_calculated: unit === "PCS" && sourceUnit === "M" && pieceLength > 0 ? quantity : null,
  };
}

function quantitySourceNote(record) {
  if (!record.piece_length_m || record.quantity_source_unit !== "M") return "";
  return `${record.quantity_source} M ÷ ${record.piece_length_m} M/PC = ${record.quantity} PCS`;
}

function mapDraftItem(item) {
  const quantity = normalizeDraftQuantity(item);
  const sourceAmount = firstDefined(item.amount_calculated, item.amount_source, item.amount);
  const fieldRecommendations = cloneJson(item.field_recommendations || item.recommendations || {});
  const materialRecommendation = normalizedFieldRecommendation({ field_recommendations: fieldRecommendations }, "material");
  const useRecommendation = normalizedFieldRecommendation({ field_recommendations: fieldRecommendations }, "use");
  return {
    merge_key: item.merge_key || "",
    description_en: item.description_en || "",
    description_cn: item.description_cn || "",
    spec: item.spec || "",
    hs_code: item.hs_code || "",
    quantity: quantity.quantity,
    unit: quantity.unit,
    unit_price: quantity.unitPrice,
    unit_price_method: item.unit_price_method || (firstDefined(item.unit_price_source, item.source_unit_price) !== undefined ? "source" : "unknown"),
    unit_price_basis: item.unit_price_basis || "",
    price_confirmed: item.price_confirmed === true || item.unit_price_method === "source",
    amount: sourceAmount === undefined ? quantity.quantity * quantity.unitPrice : draftNumber(sourceAmount),
    material: item.material || materialRecommendation.recommended || "",
    use: item.use || useRecommendation.recommended || "",
    field_recommendations: fieldRecommendations,
    source: [item.allocation_method ? `整理稿导入 · ${item.allocation_method}` : "整理稿导入", quantitySourceNote(quantity)].filter(Boolean).join(" · "),
    confidence: item.confidence || "imported",
    container_breakdown: item.container_breakdown || [],
    quantity_source: quantity.quantity_source,
    quantity_source_unit: quantity.quantity_source_unit,
    piece_length_m: quantity.piece_length_m,
    piece_count_calculated: quantity.piece_count_calculated,
    source_total_length_m: item.source_total_length_m ?? null,
    piece_count_source: item.piece_count_source ?? null,
    pieces_per_package: item.pieces_per_package ?? null,
    package_count_source: item.package_count_source ?? null,
    package_count_calculated: item.package_count_calculated ?? null,
    loose_piece_count: item.loose_piece_count ?? null,
    set_basis: item.set_basis || "",
    quantity_calculation_method: item.quantity_calculation_method || "",
    calculation_breakdown: item.calculation_breakdown || [],
    evidence: item.evidence || [],
    hs_code_reference: cloneJson(item.hs_code_reference || {}),
  };
}

function mapDraftPackingLine(line) {
  const quantity = normalizeDraftQuantity(line);
  const grossWeight = draftNumberOrBlank(line.gross_weight_calculated, line.gross_weight_source, line.gross_weight);
  let netWeight = draftNumberOrBlank(line.net_weight_calculated, line.net_weight_source, line.net_weight);
  let netWeightMethod = line.net_weight_method || "";
  if (netWeight === "" && Number(grossWeight || 0) > 0) {
    netWeight = Number((Number(grossWeight) * 0.9).toFixed(3));
    netWeightMethod = "default_90_percent_of_gross";
  }
  return {
    merge_key: line.merge_key || "",
    description_en: line.description_en || "",
    quantity: quantity.quantity,
    unit: quantity.unit,
    packages: draftNumber(firstDefined(line.packages, 0)),
    gross_weight: grossWeight,
    net_weight: netWeight,
    net_weight_method: netWeightMethod,
    cbm: draftNumberOrBlank(line.cbm_calculated, line.cbm_source, line.cbm),
    hs_code: line.hs_code || "",
    source: [line.method ? `整理稿导入 · ${line.method}` : "整理稿导入", quantitySourceNote(quantity)].filter(Boolean).join(" · "),
    confidence: line.confidence || "imported",
    container_breakdown: line.container_breakdown || [],
    quantity_source: quantity.quantity_source,
    quantity_source_unit: quantity.quantity_source_unit,
    piece_length_m: quantity.piece_length_m,
    piece_count_calculated: quantity.piece_count_calculated,
    source_total_length_m: line.source_total_length_m ?? null,
    piece_count_source: line.piece_count_source ?? null,
    pieces_per_package: line.pieces_per_package ?? null,
    package_count_source: line.package_count_source ?? null,
    package_count_calculated: line.package_count_calculated ?? null,
    loose_piece_count: line.loose_piece_count ?? null,
    set_basis: line.set_basis || "",
    quantity_calculation_method: line.quantity_calculation_method || "",
    calculation_breakdown: line.calculation_breakdown || [],
    evidence: line.evidence || [],
  };
}

function sourceRowForCurrent(originalRows, currentRow, index) {
  if (currentRow.merge_key) {
    const matched = originalRows.find((row) => row.merge_key === currentRow.merge_key);
    if (matched) return matched;
  }
  return originalRows[index] || {};
}

function mergeCurrentItems(originalRows, currentRows) {
  return currentRows.map((row, index) => {
    const merged = cloneJson(sourceRowForCurrent(originalRows, row, index));
    return {
      ...merged,
      merge_key: row.merge_key || merged.merge_key || "",
      description_en: row.description_en,
      description_cn: row.description_cn,
      spec: row.spec || merged.spec || "",
      hs_code: row.hs_code,
      quantity: row.quantity,
      pipkg_quantity: row.quantity,
      unit: row.unit,
      pipkg_quantity_unit: row.unit,
      unit_price: row.unit_price,
      pipkg_unit_price: row.unit_price,
      unit_price_method: row.unit_price_method || merged.unit_price_method || "manual",
      unit_price_basis: row.unit_price_basis || merged.unit_price_basis || "",
      price_confirmed: row.price_confirmed === true,
      amount: row.amount,
      amount_calculated: row.amount,
      material: row.material,
      use: row.use,
      field_recommendations: cloneJson(row.field_recommendations || merged.field_recommendations || {}),
      confidence: row.confidence || merged.confidence || "manual",
      container_breakdown: row.container_breakdown || merged.container_breakdown || [],
      quantity_source: row.quantity_source ?? merged.quantity_source ?? null,
      quantity_source_unit: row.quantity_source_unit || merged.quantity_source_unit || row.unit,
      piece_length_m: row.piece_length_m ?? merged.piece_length_m ?? null,
      piece_count_calculated: row.piece_count_calculated ?? merged.piece_count_calculated ?? null,
      source_total_length_m: row.source_total_length_m ?? merged.source_total_length_m ?? null,
      piece_count_source: row.piece_count_source ?? merged.piece_count_source ?? null,
      pieces_per_package: row.pieces_per_package ?? merged.pieces_per_package ?? null,
      package_count_source: row.package_count_source ?? merged.package_count_source ?? null,
      package_count_calculated: row.package_count_calculated ?? merged.package_count_calculated ?? null,
      loose_piece_count: row.loose_piece_count ?? merged.loose_piece_count ?? null,
      set_basis: row.set_basis || merged.set_basis || "",
      quantity_calculation_method: row.quantity_calculation_method || merged.quantity_calculation_method || "manual_review",
      calculation_breakdown: row.calculation_breakdown || merged.calculation_breakdown || [],
      evidence: row.evidence || merged.evidence || [],
      hs_code_reference: cloneJson(row.hs_code_reference || merged.hs_code_reference || {}),
    };
  });
}

function mergeCurrentPackingLines(originalRows, currentRows) {
  return currentRows.map((row, index) => {
    const merged = cloneJson(sourceRowForCurrent(originalRows, row, index));
    return {
      ...merged,
      merge_key: row.merge_key || merged.merge_key || "",
      description_en: row.description_en,
      hs_code: row.hs_code,
      quantity: row.quantity,
      pipkg_quantity: row.quantity,
      unit: row.unit,
      pipkg_quantity_unit: row.unit,
      packages: row.packages,
      gross_weight: row.gross_weight,
      gross_weight_calculated: row.gross_weight,
      net_weight: row.net_weight,
      net_weight_calculated: row.net_weight,
      net_weight_method: row.net_weight_method || merged.net_weight_method || "",
      cbm: row.cbm,
      cbm_calculated: row.cbm,
      confidence: row.confidence || merged.confidence || "manual",
      container_breakdown: row.container_breakdown || merged.container_breakdown || [],
      quantity_source: row.quantity_source ?? merged.quantity_source ?? null,
      quantity_source_unit: row.quantity_source_unit || merged.quantity_source_unit || row.unit,
      piece_length_m: row.piece_length_m ?? merged.piece_length_m ?? null,
      piece_count_calculated: row.piece_count_calculated ?? merged.piece_count_calculated ?? null,
      source_total_length_m: row.source_total_length_m ?? merged.source_total_length_m ?? null,
      piece_count_source: row.piece_count_source ?? merged.piece_count_source ?? null,
      pieces_per_package: row.pieces_per_package ?? merged.pieces_per_package ?? null,
      package_count_source: row.package_count_source ?? merged.package_count_source ?? null,
      package_count_calculated: row.package_count_calculated ?? merged.package_count_calculated ?? null,
      loose_piece_count: row.loose_piece_count ?? merged.loose_piece_count ?? null,
      set_basis: row.set_basis || merged.set_basis || "",
      quantity_calculation_method: row.quantity_calculation_method || merged.quantity_calculation_method || "manual_review",
      calculation_breakdown: row.calculation_breakdown || merged.calculation_breakdown || [],
      evidence: row.evidence || merged.evidence || [],
    };
  });
}

function currentFieldCopy(name) {
  return state.current?.fields?.[name] ? cloneJson(state.current.fields[name]) : undefined;
}

function syncCurrentGroup() {
  if (!state.current || state.activeGroupIndex < 0) return;
  const groups = state.current.shipment_groups || [];
  const group = groups[state.activeGroupIndex];
  if (!group) return;

  const fieldMap = {
    invoice_no: "invoice_no",
    invoice_date: "invoice_date",
    bill_of_lading_no: "bill_of_lading_no",
    shipper_block: "shipper_block",
    consignee_company: "consignee_block",
    transport: "transport",
    origin_country: "origin_country",
    loading_port: "loading_port",
    destination_port: "destination_port",
    trade_term: "trade_term",
    payment_term: "payment_term",
    gross_weight: "gross_weight",
  };
  Object.entries(fieldMap).forEach(([fieldName, groupName]) => {
    const value = currentFieldCopy(fieldName);
    if (value) group[groupName] = value;
  });

  group.si = group.si || {};
  const siTemplate = currentFieldCopy("si_template");
  const containerQty = currentFieldCopy("container_qty");
  const vesselVoyage = currentFieldCopy("vessel_voyage");
  if (siTemplate) group.si.si_template = valueFromDraftField(siTemplate);
  if (containerQty) group.si.container_qty = containerQty;
  if (vesselVoyage) group.si.vessel_voyage = vesselVoyage;

  group.items = mergeCurrentItems(group.items || [], state.current.items || []);
  group.packing_lines = mergeCurrentPackingLines(group.packing_lines || [], state.current.packing_lines || []);
  group.issues = cloneJson(state.current.issues || []);
  group.packing_reconciliation = cloneJson(state.current.packing_reconciliation || {});
  group.frontend_saved_at = new Date().toISOString();
  group.totals = group.totals || {};
  group.totals.quantity = (state.current.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  group.totals.amount = Number((state.current.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
  group.totals.packages = (state.current.packing_lines || []).reduce((sum, line) => sum + Number(line.packages || 0), 0);
  group.totals.net_weight = (state.current.packing_lines || []).reduce((sum, line) => sum + Number(line.net_weight || 0), 0);
  groups[state.activeGroupIndex] = group;
}

function buildEditableDraftPayload() {
  syncCurrentGroup();
  const payload = cloneJson(state.draftPayload || {});
  payload.case_no = state.current?.base_case_no || state.current?.case?.case_no || payload.case_no || "IMPORTED";
  payload.case = cloneJson(state.current?.case || {});
  payload.frontend_saved_at = new Date().toISOString();
  payload.frontend_save_version = 1;
  payload.last_active_group_id = state.current?.active_group_id || "";
  const shipmentType = state.current?.case?.shipment_type || "sea";
  payload.shipment_type = shipmentType;
  payload.document_type = shipmentType === "fedex" ? "fedex_commercial_invoice" : payload.document_type || "sea_pipkg";
  payload.fedex_invoice_output_count = shipmentType === "fedex" ? 1 : 0;
  payload.pipkg_output_count = shipmentType === "fedex" ? 0 : state.current?.pipkg_output_count ?? 1;
  payload.si_output_count = shipmentType === "fedex" ? 0 : state.current?.si_output_count ?? 1;
  payload.split_required = shipmentType === "sea" && Boolean(state.current?.split_required);
  payload.knowledge_candidates = cloneJson(state.current?.knowledge_candidates || payload.knowledge_candidates || []);
  payload.knowledge_feedback = cloneJson(state.current?.knowledge_feedback || payload.knowledge_feedback || []);
  payload.fedex_pricing = cloneJson(state.current?.fedex_pricing || payload.fedex_pricing || {});
  const groups = shipmentType === "fedex" ? [] : state.current?.shipment_groups || [];
  if (groups.length) {
    payload.shipment_groups = cloneJson(groups);
  } else {
    payload.shipment_groups = [];
    payload.fields = cloneJson(state.current?.fields || {});
    payload.items = mergeCurrentItems(payload.items || [], state.current?.items || []);
    payload.packing_lines = mergeCurrentPackingLines(payload.packing_lines || [], state.current?.packing_lines || []);
    payload.issues = cloneJson(state.current?.issues || []);
    payload.totals = shipmentType === "fedex"
      ? {
        quantity: (state.current?.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        packages: Number(getField("total_packages") || 0),
        amount: Number((state.current?.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
      }
      : cloneJson(state.current?.bl_totals || {});
  }
  return payload;
}

async function persistCurrentDraft() {
  if (!state.current) return;
  try {
    const payload = buildEditableDraftPayload();
    const rawText = JSON.stringify(payload, null, 2);
    const sourceName = state.draftFileName || `${payload.case_no || "整理稿"}.json`;
    const record = await saveDraftHistory(rawText, payload, sourceName, state.activeHistoryId);
    state.activeHistoryId = record.id;
    state.draftPayload = payload;
    state.draftFileName = record.sourceName;
    qs("draftText").value = rawText;
    qs("importStatus").textContent = `修改已保存到本机历史：${record.caseNo}`;
    setSaveState("saved");
    setStatus("已保存");
    renderGroups();
  } catch (error) {
    setSaveState("error");
    setStatus("保存失败");
    qs("importStatus").textContent = `保存失败：${error.message}`;
  }
}

function applyShipmentGroup(group, index = 0) {
  if (!state.current) return;
  if (state.activeGroupIndex >= 0) syncCurrentGroup();
  state.activeGroupIndex = index;
  state.current.active_group_id = group.group_id || valueFromDraftField(group.bill_of_lading_no) || "";
  const mapped = {
    invoice_no: group.invoice_no,
    invoice_date: group.invoice_date,
    bill_of_lading_no: group.bill_of_lading_no,
    booking_no: group.booking_no,
    shipper_block: partyFieldFromDraft(group, "shipper"),
    consignee_company: partyFieldFromDraft(group, "consignee"),
    transport: group.transport,
    origin_country: group.origin_country,
    loading_port: group.loading_port,
    destination_port: group.destination_port,
    trade_term: firstDraftField(group, ["trade_term", "terms_of_delivery", "delivery_term", "incoterm"]),
    payment_term: firstDraftField(group, ["payment_term", "terms_of_payment", "payment_terms"]),
    gross_weight: firstDraftField(group, ["gross_weight"]) ?? group.totals?.gross_weight,
    container_qty: group.si?.container_qty,
    vessel_voyage: group.si?.vessel_voyage,
    si_template: group.si?.si_template || group.si?.carrier,
  };
  Object.entries(mapped).forEach(([key, field]) => {
    const value = valueFromDraftField(field);
    if (value !== undefined && value !== null && value !== "") {
      state.current.fields[key] = fieldObjectFromDraft(field);
    }
  });
  if (valueFromDraftField(mapped.shipper_block)) {
    state.current.fields.shipper_code = fieldObjectFromDraft(partyCodeForBlock("shipper", valueFromDraftField(mapped.shipper_block)));
  }
  if (valueFromDraftField(mapped.consignee_company)) {
    state.current.fields.consignee_code = fieldObjectFromDraft(partyCodeForBlock("consignee", valueFromDraftField(mapped.consignee_company)));
  }
  ensureDefaultInvoiceFields();
  const explicitGroupInvoice = String(valueFromDraftField(group.invoice_no) || "").trim().toUpperCase();
  const groupInvoiceNo = invoiceNumberPattern.test(explicitGroupInvoice)
    ? explicitGroupInvoice
    : invoiceNoForGroup(state.current.base_case_no, index);
  if (groupInvoiceNo) {
    reserveInvoiceNumber(groupInvoiceNo);
    state.current.case.case_no = groupInvoiceNo;
    state.current.fields.invoice_no = {
      value: groupInvoiceNo,
      confidence: "manual",
      evidence: [{ file: "split_rule", locator: "bill_of_lading_group", text: "按提单顺序递增单号尾号" }],
    };
  }
  state.current.items = (group.items || []).map(mapDraftItem);
  state.current.packing_lines = (group.packing_lines || []).map(mapDraftPackingLine);
  state.current.bl_totals = normalizeDraftTotals(group.totals || {}, group.si?.containers || []);
  state.current.issues = group.issues || [];
  recalculateCurrent();
  renderAll();
}

function applyDraft(payload) {
  const draft = cloneJson(payload);
  const shipmentType = inferDraftShipmentType(draft);
  state.activeGroupIndex = -1;
  state.activeHistoryId = "";
  state.draftPayload = draft;
  setSaveState("idle");
  const incomingInvoice = String(
    valueFromDraftField(draft.fields?.invoice_no)
      || valueFromDraftField(draft.shipment_groups?.[0]?.invoice_no)
      || draft.case_no
      || "",
  ).trim().toUpperCase();
  const sourceFiles = draft.files || draft.file_inventory || [];
  state.current = {
    case: { ...(draft.case || {}), case_no: incomingInvoice || draft.case_no || "IMPORTED", shipment_type: shipmentType },
    case_no: draft.case_no || incomingInvoice || "IMPORTED",
    shipment_type: shipmentType,
    document_type: shipmentType === "fedex" ? "fedex_commercial_invoice" : draft.document_type || "sea_pipkg",
    files: sourceFiles.map((file) => ({
      ...file,
      name: file.name || file.file_name || "未命名文件",
      kind: file.kind || file.file_type || "unknown",
      health: file.health || "needs_review",
      classification: file.classification || { category: file.category || "unknown", confidence: file.confidence || "low", reason: file.reason || "" },
    })),
    fields: {},
    items: [],
    packing_lines: [],
    issues: cloneJson(draft.issues || []),
    shipment_groups: shipmentType === "sea" ? cloneJson(draft.shipment_groups || []) : [],
    split_required: shipmentType === "sea" && Boolean(draft.split_required),
    fedex_invoice_output_count: shipmentType === "fedex" ? 1 : 0,
    pipkg_output_count: shipmentType === "fedex" ? 0 : draft.pipkg_output_count ?? Math.max(1, draft.shipment_groups?.length || 1),
    si_output_count: shipmentType === "fedex" ? 0 : draft.si_output_count ?? Math.max(1, draft.shipment_groups?.length || 1),
    skill_trace: cloneJson(draft.skill_trace || []),
    knowledge_candidates: cloneJson(draft.knowledge_candidates || []),
    knowledge_feedback: cloneJson(draft.knowledge_feedback || []),
    fedex_pricing: cloneJson(draft.fedex_pricing || { estimated_total_cap_usd: 80, contains_ai_estimates: false }),
    totals: cloneJson(draft.totals || {}),
  };
  Object.entries(draft.fields || {}).forEach(([key, field]) => {
    const value = valueFromDraftField(field);
    if (value !== undefined && value !== null && value !== "") {
      state.current.fields[key] = fieldObjectFromDraft(field);
    }
  });
  const topLevelShipper = partyFieldFromDraft(draft.fields || draft, "shipper");
  const topLevelConsignee = partyFieldFromDraft(draft.fields || draft, "consignee");
  if (topLevelShipper) state.current.fields.shipper_block = fieldObjectFromDraft(topLevelShipper);
  if (topLevelConsignee) state.current.fields.consignee_company = fieldObjectFromDraft(topLevelConsignee);
  if (topLevelShipper) state.current.fields.shipper_code = fieldObjectFromDraft(partyCodeForBlock("shipper", valueFromDraftField(topLevelShipper)));
  if (topLevelConsignee) state.current.fields.consignee_code = fieldObjectFromDraft(partyCodeForBlock("consignee", valueFromDraftField(topLevelConsignee)));
  const topLevelTradeTerm = firstDraftField(draft.fields || draft, ["trade_term", "terms_of_delivery", "delivery_term", "incoterm"]);
  const topLevelPaymentTerm = firstDraftField(draft.fields || draft, ["payment_term", "terms_of_payment", "payment_terms"]);
  if (topLevelTradeTerm) state.current.fields.trade_term = fieldObjectFromDraft(topLevelTradeTerm);
  if (topLevelPaymentTerm) state.current.fields.payment_term = fieldObjectFromDraft(topLevelPaymentTerm);
  if (!getField("invoice_no") && invoiceNumberPattern.test(String(draft.case_no || "").toUpperCase())) {
    state.current.fields.invoice_no = fieldObjectFromDraft(String(draft.case_no).toUpperCase());
  }
  const importedInvoiceNo = getField("invoice_no");
  if (importedInvoiceNo) {
    state.current.case.case_no = importedInvoiceNo;
    state.current.base_case_no = importedInvoiceNo;
  }
  if (draft.items?.length) {
    state.current.items = draft.items.map(mapDraftItem);
  }
  if (draft.packing_lines?.length) {
    state.current.packing_lines = draft.packing_lines.map(mapDraftPackingLine);
  }
  if (draft.totals) state.current.bl_totals = normalizeDraftTotals(draft.totals, draft.si?.containers || []);
  if (shipmentType === "sea" && draft.shipment_groups?.length === 1) {
    applyShipmentGroup(draft.shipment_groups[0], 0);
  } else {
    ensureDefaultInvoiceFields();
    state.activeGroupIndex = -1;
    state.current.active_group_id = "";
    if (shipmentType === "fedex") applyFedexHsKnowledge(state.current);
    recalculateCurrent();
    if (shipmentType === "fedex") state.current = validateInBrowser(state.current);
    renderAll();
    if (shipmentType === "sea" && draft.shipment_groups?.length > 1) openTab("groups");
    if (shipmentType === "fedex") openTab("fields");
  }
}

async function importDraft() {
  try {
    const text = qs("draftText").value;
    const payload = extractJsonFromText(text);
    applyDraft(payload);
    let historySaved = true;
    try {
      const record = await saveDraftHistory(text, state.draftPayload || payload, state.draftFileName || "粘贴导入");
      state.activeHistoryId = record.id;
      setSaveState("saved");
    } catch {
      historySaved = false;
    }
    const groupCount = payload.shipment_groups?.length || 0;
    const importMessage = inferDraftShipmentType(payload) === "fedex"
      ? "已导入 FedEx 整理稿，已刷新基础信息、商品、价格和 HS Code 参考。"
      : groupCount > 1
      ? `已导入整理稿：识别到 ${groupCount} 个提单组，请在“拆单”页选择要核验的提单。`
      : "已导入整理稿，已刷新基础信息、PI、PKG 和提单差异核对。";
    qs("importStatus").textContent = `${importMessage}${historySaved ? " 已保存到历史。" : " 当前浏览器无法保存历史。"}`;
  } catch (error) {
    qs("importStatus").textContent = `导入失败：${error.message}`;
  }
}

function renderAll() {
  renderShipmentMode();
  renderCases();
  renderFiles();
  renderSummary();
  renderGroups();
  renderFields();
  renderSiFields();
  renderItems();
  renderPacking();
  renderReconciliation();
  renderIssues();
  updateSaveButton();
}

async function loadCases() {
  setStatus("加载中");
  try {
    const payload = await api("/api/cases");
    state.remoteMode = false;
    state.cases = payload.cases;
    if (state.cases.length && !qs("folderInput").value) qs("folderInput").value = state.cases[0].path;
    setStatus("就绪");
  } catch {
    state.remoteMode = true;
    state.cases = [];
    qs("folderInput").value = "远程模式：请在“整理稿导入”上传 JSON";
    qs("folderInput").disabled = true;
    qs("scanButton").disabled = true;
    setStatus("远程模式");
    qs("draftImportPanel").open = true;
  }
  renderCases();
}

async function loadKnowledge() {
  let knowledge;
  try {
    knowledge = await api("/api/knowledge");
  } catch {
    knowledge = cloneJson(fallbackKnowledge);
  }
  try {
    const response = await fetch("./data/fedex-product-hs-knowledge.json");
    if (response.ok) knowledge.fedex_products = (await response.json()).entries || [];
  } catch {
    knowledge.fedex_products = knowledge.fedex_products || [];
  }
  state.knowledge = knowledge;
  await refreshLocalHsKnowledge();
}

async function scanFolder(folder) {
  setStatus("扫描中");
  const payload = await api("/api/scan", {
    method: "POST",
    body: JSON.stringify({ folder }),
  });
  state.current = payload;
  state.activeGroupIndex = -1;
  state.activeHistoryId = "";
  state.draftPayload = null;
  setSaveState("idle");
  ensureDefaultInvoiceFields();
  applyFedexHsKnowledge(state.current);
  if (!state.current.fields.si_template) {
    state.current.fields.si_template = { value: "MSC", confidence: "manual", evidence: [] };
  }
  qs("exportBox").innerHTML = "<span>尚未导出</span>";
  setStatus("已扫描");
  renderAll();
}

async function validateCurrent() {
  if (!state.current) return;
  setStatus("校验中");
  if (state.remoteMode) {
    state.current = validateInBrowser(state.current);
    markDirty();
    setStatus("已校验");
    renderAll();
    return;
  }
  try {
    state.current = await api("/api/validate", {
      method: "POST",
      body: JSON.stringify(state.current),
    });
  } catch {
    state.current = validateInBrowser(state.current);
  }
  markDirty();
  setStatus("已校验");
  renderAll();
}

async function exportCurrent() {
  return exportByKind("pipkg");
}

async function exportByKind(kind) {
  if (!state.current) return;
  qs("exportMenu").hidden = true;
  const shipmentType = state.current.case?.shipment_type;
  if (kind === "si") {
    qs("exportBox").innerHTML = `
      <strong>SI 模板未配置</strong>
      <span>当前只保留 SI 核验字段和柜号预分配入口；等船公司 SI 模板确认后再开放 SI Excel 导出。</span>
    `;
    return;
  }
  await validateCurrent();
  const blockingIssues = state.current.issues.filter((issue) => issue.level === "error");
  if (blockingIssues.length) {
    qs("exportBox").innerHTML = `
      <strong>导出已暂停</strong>
      <span>当前还有 ${blockingIssues.length} 个阻塞问题，请先处理拆单、商品或必填字段后再导出。</span>
    `;
    return;
  }
  setStatus("导出中");
  if (state.remoteMode) {
    try {
      const filename = shipmentType === "fedex"
        ? await exportFedexInBrowser(state.current)
        : await exportPipkgInBrowser(state.current);
      qs("exportBox").innerHTML = `<strong>${filename}</strong><span>文件已在本机浏览器内生成并下载，整理稿数据未上传到服务器。</span>`;
      setStatus("已导出");
    } catch (error) {
      qs("exportBox").innerHTML = `<strong>导出失败</strong><span>${error.message}</span>`;
      setStatus("导出失败");
    }
    return;
  }
  try {
    const result = await api("/api/export", {
      method: "POST",
      body: JSON.stringify(state.current),
    });
    qs("exportBox").innerHTML = `
      <a href="${result.download_url}">${result.filename}</a>
      <span>${result.issues.length} 个问题随文件记录，导出前请确认关键字段。</span>
    `;
  } catch {
    try {
      const filename = shipmentType === "fedex"
        ? await exportFedexInBrowser(state.current)
        : await exportPipkgInBrowser(state.current);
      qs("exportBox").innerHTML = `<strong>${filename}</strong><span>文件已由浏览器生成并下载。</span>`;
    } catch (error) {
      qs("exportBox").innerHTML = `<strong>导出失败</strong><span>${error.message}</span>`;
      setStatus("导出失败");
      return;
    }
  }
  setStatus("已导出");
}

function toggleExportMenu(event) {
  event.stopPropagation();
  if (state.current?.case?.shipment_type === "fedex") {
    exportByKind("fedex");
    return;
  }
  const menu = qs("exportMenu");
  menu.hidden = !menu.hidden;
}

function addItem() {
  if (!state.current) return;
  state.current.items.push({
    description_en: "",
    description_cn: "",
    hs_code: "",
    quantity: "",
    unit: "PCS",
    unit_price: "",
    unit_price_method: "manual",
    price_confirmed: true,
    amount: "",
    material: "",
    use: "",
    source: "manual",
    confidence: "manual",
    hs_code_reference: { status: "unresolved", needs_confirmation: true, confidence: "low", suggested_hs_code: "" },
  });
  markDirty();
  renderItems();
  renderSummary();
}

function addPacking() {
  if (!state.current) return;
  state.current.packing_lines.push({
    description_en: "",
    quantity: "",
    unit: "PCS",
    packages: "",
    gross_weight: "",
    net_weight: "",
    cbm: "",
    hs_code: "",
    source: "manual",
    confidence: "manual",
  });
  markDirty();
  renderPacking();
  renderSummary();
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      qs(`tab-${button.dataset.tab}`).classList.add("active");
    });
  });
}

function bindActions() {
  qs("refreshCases").addEventListener("click", loadCases);
  qs("toggleSidebar").addEventListener("click", toggleSidebar);
  document.querySelectorAll("[data-source-view]").forEach((button) => {
    button.addEventListener("click", () => setSourceView(button.dataset.sourceView));
  });
  qs("historySearch").addEventListener("input", (event) => {
    state.historyQuery = event.target.value;
    renderDraftHistory();
  });
  qs("clearHistoryButton").addEventListener("click", clearDraftHistory);
  qs("importKnowledgeButton").addEventListener("click", importKnowledgeFile);
  qs("exportKnowledgeButton").addEventListener("click", exportLocalKnowledge);
  qs("scanButton").addEventListener("click", () => scanFolder(qs("folderInput").value));
  qs("saveButton").addEventListener("click", persistCurrentDraft);
  qs("validateButton").addEventListener("click", validateCurrent);
  qs("exportButton").addEventListener("click", toggleExportMenu);
  qs("exportMenu").querySelectorAll("[data-export-kind]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      exportByKind(button.dataset.exportKind);
    });
  });
  document.addEventListener("click", () => {
    qs("exportMenu").hidden = true;
  });
  qs("addItem").addEventListener("click", addItem);
  qs("addPacking").addEventListener("click", addPacking);
  qs("importDraftButton").addEventListener("click", importDraft);
  qs("draftFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.draftFileName = file.name;
    qs("draftText").value = await file.text();
    qs("importStatus").textContent = `已读取：${file.name}`;
  });
  qs("draftText").addEventListener("input", () => {
    state.draftFileName = "";
  });
  document.querySelectorAll("[data-shipment-type]").forEach((button) => {
    button.addEventListener("click", () => setShipmentType(button.dataset.shipmentType));
  });
  document.querySelectorAll("[data-open-tab]").forEach((button) => {
    button.addEventListener("click", () => openTab(button.dataset.openTab));
  });
}

function openTab(tabName) {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((item) => item.classList.toggle("active", item.id === `tab-${tabName}`));
  document.querySelector(`.tab[data-tab="${tabName}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
}

window.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindActions();
  restoreSidebarState();
  await refreshDraftHistory();
  try {
    await loadKnowledge();
    await loadCases();
    if (!state.remoteMode && qs("folderInput").value) {
      await scanFolder(qs("folderInput").value);
    }
  } catch (error) {
    setStatus("错误");
    qs("issueList").innerHTML = `<div class="issue-card error"><div class="card-title">启动失败</div><div class="card-meta">${error.message}</div></div>`;
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
