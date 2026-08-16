const state = {
  cases: [],
  knowledge: { companies: [], consignees: [] },
  current: null,
  activeGroupIndex: -1,
  remoteMode: false,
};

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
  trade_term: "贸易条款",
  gross_weight: "总毛重",
  si_template: "SI模板",
  container_qty: "柜量",
  vessel_voyage: "船名航次",
  bill_of_lading_no: "提单号",
};

const fixedFields = [
  "invoice_no",
  "invoice_date",
  "shipper_block",
  "consignee_company",
  "transport",
  "origin_country",
  "loading_port",
  "destination_port",
  "trade_term",
  "gross_weight",
];

const siFields = [
  "si_template",
  "container_qty",
  "vessel_voyage",
  "bill_of_lading_no",
];

function qs(id) {
  return document.getElementById(id);
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
  const match = String(issue.field || "").match(/^(items|packing_lines)\[(\d+)\](?:\.|$)/);
  if (!match) return true;
  return Number(match[2]) < (data[match[1]] || []).length;
}

function validateInBrowser(data) {
  const issues = (data.issues || []).filter(
    (issue) => issue.source === "trade-doc-summary-extractor" && extractionIssueIsCurrent(issue, data),
  );
  const add = (level, type, message, field) => issues.push({ level, type, message, field, source: "browser-validator" });
  const fields = data.fields || {};
  const shipmentType = data.case?.shipment_type;
  if (shipmentType === "sea" && (data.shipment_groups || []).length > 1 && !data.active_group_id) {
    add("error", "multiple_bill_of_lading", `检测到 ${data.shipment_groups.length} 个提单号，需要先在拆单页选择一个提单组再导出 PIPKG`, "shipment_groups");
  }
  const required = ["invoice_no", "invoice_date", "shipper_block", "consignee_company"];
  if (shipmentType === "sea") required.push("loading_port", "destination_port");
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
    if (!item.hs_code) add("warning", "missing_hs_code", `第 ${index + 1} 行缺少 HS code`, `items[${index}].hs_code`);
  });
  (data.packing_lines || []).forEach((line, index) => {
    if (line.gross_weight === null || line.gross_weight === "" || line.gross_weight === undefined) {
      add("warning", "missing_packing_weight", `包装第 ${index + 1} 行缺少毛重，导出前建议人工补录`, `packing_lines[${index}].gross_weight`);
    }
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

async function exportPipkgInBrowser(data) {
  if (!window.ExcelJS) throw new Error("Excel 导出组件未加载");
  const templateResponse = await fetch("../templates/FT0126021101样例.xlsx");
  if (!templateResponse.ok) throw new Error("无法读取 PIPKG 模板");
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await templateResponse.arrayBuffer());
  const pi = workbook.getWorksheet("PI");
  const pkg = workbook.getWorksheet("PKG");
  if (!pi || !pkg) throw new Error("PIPKG 模板缺少 PI 或 PKG 工作表");
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
  const paymentText = `TT ${fieldValue(data, "trade_term", "TT")} ${fieldValue(data, "destination_port")}`.trim();
  setWorkbookCell(pi, "C15", paymentText);
  setWorkbookCell(pkg, "C11", paymentText);
  clearWorkbookRows(pi, 19, 34, 1, 7);
  clearWorkbookRows(pkg, 15, 32, 1, 8);
  (data.items || []).slice(0, 16).forEach((item, index) => {
    const row = 19 + index;
    setWorkbookCell(pi, `A${row}`, `${item.description_en || ""} ${item.hs_code || ""}`.trim());
    setWorkbookCell(pi, `D${row}`, Number(item.quantity || 0));
    setWorkbookCell(pi, `E${row}`, Number(item.unit_price || 0));
    pi.getCell(`F${row}`).value = { formula: `D${row}*E${row}` };
    setWorkbookCell(pi, `G${row}`, item.hs_code || "");
  });
  const packing = (data.packing_lines || []).length
    ? data.packing_lines
    : (data.items || []).map((item) => ({ ...item, packages: "", gross_weight: "", net_weight: "", cbm: "" }));
  packing.slice(0, 18).forEach((line, index) => {
    const row = 15 + index;
    setWorkbookCell(pkg, `A${row}`, `${line.description_en || ""} ${line.hs_code || ""}`.trim());
    setWorkbookCell(pkg, `C${row}`, Number(line.quantity || 0));
    setWorkbookCell(pkg, `D${row}`, Number(line.packages || 0));
    setWorkbookCell(pkg, `E${row}`, line.gross_weight === "" ? "" : Number(line.gross_weight || 0));
    setWorkbookCell(pkg, `F${row}`, line.net_weight === "" ? "" : Number(line.net_weight || 0));
    setWorkbookCell(pkg, `G${row}`, line.cbm === "" ? "" : Number(line.cbm || 0));
    setWorkbookCell(pkg, `H${row}`, line.hs_code || "");
  });
  pi.getCell("D37").value = { formula: "SUM(D19:D34)" };
  pi.getCell("F37").value = { formula: "SUM(F19:F34)" };
  pkg.getCell("C33").value = { formula: "SUM(C15:C32)" };
  pkg.getCell("D33").value = { formula: "SUM(D15:D32)" };
  pkg.getCell("E33").value = { formula: "SUM(E15:E32)" };
  pkg.getCell("F33").value = { formula: "SUM(F15:F32)" };
  pkg.getCell("G33").value = { formula: "SUM(G15:G32)" };
  workbook.calcProperties.fullCalcOnLoad = true;
  const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `${caseNo} PI PKG.xlsx`;
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

function partyBlock(party) {
  return [party.company, party.address, party.contact, party.email].filter(Boolean).join("\n");
}

function companyByCode(code) {
  return state.knowledge.companies.find((item) => item.code === code);
}

function consigneeByCode(code) {
  return state.knowledge.consignees.find((item) => item.code === code);
}

function detectCompanyCode() {
  const stored = getField("shipper_code");
  if (companyByCode(stored)) return stored;
  const block = String(getField("shipper_block") || getField("shipper_company")).toUpperCase();
  const matched = state.knowledge.companies.find((item) => block.includes(item.company.toUpperCase()));
  return matched?.code || "CUSTOM";
}

function detectConsigneeCode() {
  const stored = getField("consignee_code");
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
  if (file.classification.category === "packing") return "装箱单";
  if (["supplier_pi", "sales_contract", "fedex_invoice_source"].includes(file.classification.category)) return "货单";
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
  const totalPackages = (data.packing_lines || []).reduce((sum, item) => sum + Number(item.packages || 0), 0);
  const groupCount = (data.shipment_groups || []).length || 1;
  const cards = [
    ["单号", data.case.case_no],
    ["类型", data.case.shipment_type],
    ["文件", `${data.files.length} 个`],
    ["提单组", `${groupCount} 组`],
    ["金额", `USD ${money(totalAmount)}`],
    ["商品", `${data.items.length} 行`],
    ["箱数", totalPackages || "待补"],
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
  grid.innerHTML = fixedFields
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
      renderFields();
      renderSummary();
    });
  });
  grid.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      setField(event.target.dataset.field, event.target.value);
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
      renderSummary();
    });
    input.addEventListener("change", (event) => {
      setField(event.target.dataset.field, event.target.value);
      renderSummary();
    });
  });
}

function editableCell(value, key, rowIndex, tableName, textarea = false) {
  const escaped = value ?? "";
  if (textarea) {
    return `<textarea data-table="${tableName}" data-row="${rowIndex}" data-key="${key}">${escaped}</textarea>`;
  }
  return `<input data-table="${tableName}" data-row="${rowIndex}" data-key="${key}" value="${escaped}" />`;
}

function bindTableInputs(tableName) {
  document.querySelectorAll(`[data-table="${tableName}"]`).forEach((input) => {
    input.addEventListener("input", (event) => {
      const row = Number(event.target.dataset.row);
      const key = event.target.dataset.key;
      state.current[tableName][row][key] = event.target.value;
      if (tableName === "items" && ["quantity", "unit_price"].includes(key)) {
        const item = state.current.items[row];
        item.amount = Number(item.quantity || 0) * Number(item.unit_price || 0);
        const amountInput = document.querySelector(`[data-table="items"][data-row="${row}"][data-key="amount"]`);
        if (amountInput && document.activeElement !== amountInput) {
          amountInput.value = item.amount ? Number(item.amount.toFixed(2)) : "";
        }
        renderPriceSummary();
        renderCalc();
      }
      if (tableName === "items" && key === "amount") {
        renderPriceSummary();
        renderCalc();
      }
      renderSummary();
    });
  });
}

function deleteTableRow(tableName, rowIndex) {
  if (!state.current?.[tableName]?.[rowIndex]) return;
  state.current[tableName].splice(rowIndex, 1);
  reconcileIssuesAfterRowDelete(tableName, rowIndex);
  if (tableName === "items") {
    renderItems();
  } else {
    renderPacking();
  }
  renderCalc();
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

function renderItems() {
  const tbody = qs("itemsTable").querySelector("tbody");
  tbody.innerHTML = (state.current?.items || [])
    .map((item, index) => `
      <tr>
        <td>${editableCell(item.description_en, "description_en", index, "items", true)}</td>
        <td>${editableCell(item.description_cn, "description_cn", index, "items")}</td>
        <td>${editableCell(item.unit_price, "unit_price", index, "items")}</td>
        <td>${editableCell(item.quantity, "quantity", index, "items")}</td>
        <td>${editableCell(item.amount, "amount", index, "items")}</td>
        <td>${editableCell(item.hs_code, "hs_code", index, "items")}</td>
        <td>${editableCell(item.unit, "unit", index, "items")}</td>
        <td>${item.source || "manual"}</td>
        <td class="row-action-cell">
          <button type="button" class="row-delete-button" data-delete-table="items" data-delete-row="${index}" title="删除此商品行" aria-label="删除第 ${index + 1} 个商品行">×</button>
        </td>
      </tr>
    `)
    .join("");
  bindTableInputs("items");
  bindDeleteRows("items");
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
  renderCalc();
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
    if (quantity && thicknessMatch && !Number(line.gross_weight || 0)) {
      const estimate = quantity * Number(thicknessMatch[1]) * 2.5;
      line.gross_weight = Number(estimate.toFixed(1));
      line.net_weight = Number(estimate.toFixed(1));
    }
  });
  renderItems();
  renderPacking();
  renderSummary();
}

function renderCalc() {
  const grid = qs("calcGrid");
  if (!grid || !state.current) return;
  const totalAmount = state.current.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalQty = state.current.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalPkg = state.current.packing_lines.reduce((sum, line) => sum + Number(line.packages || 0), 0);
  const totalGross = state.current.packing_lines.reduce((sum, line) => sum + Number(line.gross_weight || 0), 0);
  const totalNet = state.current.packing_lines.reduce((sum, line) => sum + Number(line.net_weight || 0), 0);
  const totalCbm = state.current.packing_lines.reduce((sum, line) => sum + Number(line.cbm || 0), 0);
  grid.innerHTML = `
    <div class="summary-item"><div class="summary-label">Quantity</div><div class="summary-value">${money(totalQty)}</div></div>
    <div class="summary-item"><div class="summary-label">PKG</div><div class="summary-value">${totalPkg || "待补"}</div></div>
    <div class="summary-item"><div class="summary-label">G.W.</div><div class="summary-value">${money(totalGross)} KGS</div></div>
    <div class="summary-item"><div class="summary-label">N.W.</div><div class="summary-value">${money(totalNet)} KGS</div></div>
    <div class="summary-item"><div class="summary-label">CBM</div><div class="summary-value">${totalCbm ? money(totalCbm) : "待补"}</div></div>
    <div class="summary-item"><div class="summary-label">Total Value</div><div class="summary-value">USD ${money(totalAmount)}</div></div>
  `;
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
  if (fieldName.startsWith("packing_lines") || issueType.startsWith("missing_packing")) return "packing";
  if (["shipment_groups", "assigned_sources", "active_group_id"].includes(fieldName) || issueType === "multiple_bill_of_lading") return "groups";
  if (siFields.includes(fieldName) || fieldName.startsWith("si.")) return "si";
  if (fixedFields.includes(fieldName) || rawFieldName.endsWith("__conflict")) return "fields";
  return "groups";
}

function issueTarget(issue, tabName) {
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

function renderSkills() {
  const list = qs("skillList");
  list.innerHTML = (state.current?.skill_trace || [])
    .map((item) => `
      <div class="skill-card">
        <div class="card-title">
          <span>${item.skill}</span>
          <span class="tag ${item.status === "success" ? "high" : "medium"}">${item.status}</span>
        </div>
        <div class="card-meta">${item.message}</div>
      </div>
    `)
    .join("");
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

function invoiceNoForGroup(baseNo, index) {
  const text = String(baseNo || "");
  const match = text.match(/^(.*?)(\d{2})$/);
  if (!match) return text;
  return `${match[1]}${String(Number(match[2]) + index).padStart(2, "0")}`;
}

function mapDraftItem(item) {
  return {
    description_en: item.description_en || "",
    description_cn: item.description_cn || "",
    spec: item.spec || "",
    hs_code: item.hs_code || "",
    quantity: item.quantity || 0,
    unit: item.unit || "PCS",
    unit_price: item.unit_price || 0,
    amount: item.amount_calculated ?? item.amount_source ?? item.amount ?? 0,
    material: item.material || "",
    use: item.use || "",
    source: item.allocation_method ? `整理稿导入 · ${item.allocation_method}` : "整理稿导入",
    confidence: item.confidence || "imported",
    container_breakdown: item.container_breakdown || [],
  };
}

function mapDraftPackingLine(line) {
  return {
    description_en: line.description_en || "",
    quantity: line.quantity || 0,
    packages: line.packages || 0,
    gross_weight: line.gross_weight_calculated ?? line.gross_weight_source ?? line.gross_weight ?? "",
    net_weight: line.net_weight_calculated ?? line.net_weight_source ?? line.net_weight ?? "",
    cbm: line.cbm_calculated ?? line.cbm_source ?? line.cbm ?? "",
    hs_code: line.hs_code || "",
    source: line.method ? `整理稿导入 · ${line.method}` : "整理稿导入",
    confidence: line.confidence || "imported",
    container_breakdown: line.container_breakdown || [],
  };
}

function applyShipmentGroup(group, index = 0) {
  if (!state.current) return;
  state.activeGroupIndex = index;
  state.current.active_group_id = group.group_id || valueFromDraftField(group.bill_of_lading_no) || "";
  if (!state.current.base_case_no) {
    state.current.base_case_no = state.current.case?.case_no || getField("invoice_no");
  }
  const groupInvoiceNo = invoiceNoForGroup(state.current.base_case_no, index);
  if (groupInvoiceNo) {
    state.current.case.case_no = groupInvoiceNo;
    state.current.fields.invoice_no = {
      value: groupInvoiceNo,
      confidence: "manual",
      evidence: [{ file: "split_rule", locator: "bill_of_lading_group", text: "按提单顺序递增单号尾号" }],
    };
  }
  const mapped = {
    bill_of_lading_no: group.bill_of_lading_no,
    booking_no: group.booking_no,
    shipper_block: group.shipper_block,
    consignee_company: group.consignee_block,
    transport: group.transport,
    loading_port: group.loading_port,
    destination_port: group.destination_port,
    trade_term: group.trade_term,
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
  state.current.items = (group.items || []).map(mapDraftItem);
  state.current.packing_lines = (group.packing_lines || []).map(mapDraftPackingLine);
  state.current.issues = group.issues || [];
  recalculateCurrent();
  renderAll();
}

function applyDraft(payload) {
  if (!state.current) {
    state.current = {
      case: { case_no: "IMPORTED", shipment_type: "sea" },
      files: [],
      fields: {},
      items: [],
      packing_lines: [],
      issues: [],
      shipment_groups: [],
      skill_trace: [],
    };
  }
  const draft = payload;
  if (draft.split_required !== undefined) state.current.split_required = draft.split_required;
  if (draft.pipkg_output_count !== undefined) state.current.pipkg_output_count = draft.pipkg_output_count;
  if (draft.si_output_count !== undefined) state.current.si_output_count = draft.si_output_count;
  if (draft.shipment_groups) state.current.shipment_groups = draft.shipment_groups;
  Object.entries(draft.fields || {}).forEach(([key, field]) => {
    const value = valueFromDraftField(field);
    if (value !== undefined && value !== null && value !== "") {
      state.current.fields[key] = fieldObjectFromDraft(field);
    }
  });
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
  if (draft.issues) state.current.issues = draft.issues;
  if (draft.shipment_groups?.length === 1) {
    applyShipmentGroup(draft.shipment_groups[0], 0);
  } else {
    state.activeGroupIndex = -1;
    state.current.active_group_id = "";
    renderAll();
    if (draft.shipment_groups?.length > 1) openTab("groups");
  }
}

async function importDraft() {
  try {
    const text = qs("draftText").value;
    const payload = extractJsonFromText(text);
    applyDraft(payload);
    const groupCount = payload.shipment_groups?.length || 0;
    qs("importStatus").textContent = groupCount > 1
      ? `已导入整理稿：识别到 ${groupCount} 个提单组，请在“拆单”页选择要核验的提单。`
      : "已导入整理稿，已刷新 PIPKG / SI / 商品 / 包装 / 计算页。";
  } catch (error) {
    qs("importStatus").textContent = `导入失败：${error.message}`;
  }
}

function renderAll() {
  renderCases();
  renderFiles();
  renderSummary();
  renderGroups();
  renderFields();
  renderSiFields();
  renderItems();
  renderPacking();
  renderCalc();
  renderIssues();
  renderSkills();
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
    openTab("import");
  }
  renderCases();
}

async function loadKnowledge() {
  try {
    state.knowledge = await api("/api/knowledge");
  } catch {
    state.knowledge = fallbackKnowledge;
  }
}

async function scanFolder(folder) {
  setStatus("扫描中");
  const payload = await api("/api/scan", {
    method: "POST",
    body: JSON.stringify({ folder }),
  });
  state.current = payload;
  state.activeGroupIndex = -1;
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
  try {
    state.current = await api("/api/validate", {
      method: "POST",
      body: JSON.stringify(state.current),
    });
  } catch {
    state.current = validateInBrowser(state.current);
  }
  setStatus("已校验");
  renderAll();
}

async function exportCurrent() {
  return exportByKind("pipkg");
}

async function exportByKind(kind) {
  if (!state.current) return;
  qs("exportMenu").hidden = true;
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
    const filename = await exportPipkgInBrowser(state.current);
    qs("exportBox").innerHTML = `<strong>${filename}</strong><span>文件已由浏览器生成并下载。</span>`;
  }
  setStatus("已导出");
}

function toggleExportMenu(event) {
  event.stopPropagation();
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
    amount: "",
    material: "",
    use: "",
    source: "manual",
    confidence: "manual",
  });
  renderItems();
  renderSummary();
}

function addPacking() {
  if (!state.current) return;
  state.current.packing_lines.push({
    description_en: "",
    quantity: "",
    packages: "",
    gross_weight: "",
    net_weight: "",
    cbm: "",
    hs_code: "",
    source: "manual",
    confidence: "manual",
  });
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
  qs("scanButton").addEventListener("click", () => scanFolder(qs("folderInput").value));
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
  qs("recalculateButton").addEventListener("click", recalculateCurrent);
  qs("importDraftButton").addEventListener("click", importDraft);
  qs("draftFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    qs("draftText").value = await file.text();
    qs("importStatus").textContent = `已读取：${file.name}`;
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
