const state = {
  currentSchema: null,
  sourceSchema: null,
  sourceFields: [],
  sitemapSchemas: [],
  savedSchemas: JSON.parse(localStorage.getItem("schemaStudioSaved") || "[]")
};

const schemaExtractApi = "https://rank-tracker-studio.onrender.com/api/extract-schema";

const schemaDefaults = {
  LocalBusiness: ["name", "url", "telephone", "address", "description"],
  Organization: ["name", "url", "logo", "sameAs"],
  Person: ["name", "url", "jobTitle", "worksFor"],
  Article: ["headline", "author", "datePublished", "description"],
  BlogPosting: ["headline", "author", "datePublished", "articleBody"],
  Product: ["name", "image", "description", "sku", "offers"],
  FAQPage: ["mainEntity"],
  MedicalBusiness: ["name", "url", "telephone", "medicalSpecialty", "address"],
  Physician: ["name", "url", "medicalSpecialty", "worksFor"],
  MedicalClinic: ["name", "url", "telephone", "medicalSpecialty", "address"]
};

const dom = {
  pageTitle: document.getElementById("pageTitle"),
  toast: document.getElementById("toast"),
  schemaEditor: document.getElementById("schemaEditor"),
  structuredView: document.getElementById("structuredView"),
  validationView: document.getElementById("validationView"),
  richResultsLink: document.getElementById("richResultsLink")
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindTabs();
  bindExtraction();
  bindReplication();
  bindGenerator();
  bindTools();
  renderSavedSchemas();
  updateOutput(null);
});

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".section-panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(`${section}Section`).classList.add("active");
      dom.pageTitle.textContent = button.textContent.trim();
    });
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const group = tab.dataset.tabGroup;
      document.querySelectorAll(`.tab[data-tab-group="${group}"]`).forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      const groupPanels = [...document.querySelectorAll(`.tab[data-tab-group="${group}"]`)].map((item) => item.dataset.tab);
      groupPanels.forEach((panelId) => document.getElementById(panelId).classList.remove("active"));
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });
}

function bindExtraction() {
  document.getElementById("quickExtractForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await extractFromUrl(document.getElementById("quickUrl").value, "quick");
  });

  document.getElementById("extractForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await extractFromUrl(document.getElementById("extractUrl").value, "extractor");
  });

  document.getElementById("parseManualBtn").addEventListener("click", () => {
    const parsed = parseManualSchema(document.getElementById("manualSchemaInput").value);
    if (parsed) {
      updateOutput(parsed);
      toast("Schema parsed and loaded.");
    }
  });

  document.getElementById("parseHtmlBtn").addEventListener("click", () => {
    const html = document.getElementById("htmlInput").value.trim();
    if (!html) return toast("Paste HTML first.");
    const schema = extractSchemasFromHtml(html);
    updateOutput(schema.length ? schema : null);
    toast(schema.length ? `Found ${schema.length} schema block(s).` : "No schema markup found in the pasted HTML.");
  });

  dom.schemaEditor.addEventListener("input", () => {
    try {
      const parsed = JSON.parse(dom.schemaEditor.value);
      state.currentSchema = parsed;
      renderStructuredView(parsed);
      renderValidation(parsed);
    } catch {
      dom.validationView.className = "validation-list";
      dom.validationView.innerHTML = validationMarkup("fail", "Invalid JSON", "Fix syntax errors before copying, saving, or testing.");
    }
  });

  document.getElementById("copyExtractBtn").addEventListener("click", copyCurrentSchema);
  document.getElementById("downloadJsonBtn").addEventListener("click", () => downloadCurrentSchema("json"));
  document.getElementById("downloadTxtBtn").addEventListener("click", () => downloadCurrentSchema("txt"));
}

function bindReplication() {
  document.getElementById("competitorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const schema = await extractFromUrl(document.getElementById("competitorUrl").value, "replicator", false);
    if (schema) setSourceSchema(schema);
  });

  document.getElementById("useCustomSchemaBtn").addEventListener("click", () => {
    const parsed = parseManualSchema(document.getElementById("customReplicateSchema").value);
    if (parsed) setSourceSchema(parsed);
  });

  document.getElementById("replicateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const template = state.sourceSchema || state.currentSchema;
    if (!template) return toast("Add a source schema first.");
    const adapted = adaptSchema(template, getBusinessData());
    updateOutput(adapted);
    toast("Replicated schema generated.");
  });

  document.getElementById("sitemapUrlForm").addEventListener("submit", handleSitemapUrlSubmit);
  document.getElementById("sitemapUpload").addEventListener("change", handleSitemapUpload);
  document.getElementById("saveSchemaBtn").addEventListener("click", saveCurrentSchema);
}

function bindGenerator() {
  document.getElementById("generatorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const schema = buildGeneratedSchema();
    updateOutput(schema);
    addChat("assistant", `Generated ${schema["@type"]} schema with a clean Schema.org baseline. Review required fields in the validation tab.`);
  });

  document.getElementById("improveAiBtn").addEventListener("click", () => {
    if (!state.currentSchema) return toast("Generate or load schema first.");
    const improved = improveSchema(state.currentSchema);
    updateOutput(improved);
    addChat("assistant", "I added practical search enhancements where possible: context, description fallbacks, URLs, publisher metadata, and FAQ cleanup.");
  });

  document.getElementById("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;
    addChat("user", message);
    input.value = "";
    addChat("assistant", getAssistantReply(message));
  });
}

function bindTools() {
  document.getElementById("compareBtn").addEventListener("click", compareSchemas);
  document.getElementById("loadSavedBtn").addEventListener("click", () => {
    document.querySelector('[data-section="tools"]').click();
    renderSavedSchemas();
  });
  document.getElementById("clearSavedBtn").addEventListener("click", () => {
    state.savedSchemas = [];
    localStorage.setItem("schemaStudioSaved", "[]");
    renderSavedSchemas();
    toast("Saved schemas cleared.");
  });
}

async function extractFromUrl(url, context = "extractor", shouldUpdateOutput = true) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) return toast("Enter a valid URL.");

  toast("Attempting server-assisted extraction.");
  try {
    const html = await fetchHtmlForExtraction(cleanUrl);
    const schema = extractSchemasFromHtml(html, cleanUrl);

    if (shouldUpdateOutput) updateOutput(schema.length ? schema : null);
    if (schema.length) {
      toast(`Found ${schema.length} schema block(s).`);
      return schema;
    }
    toast("No schema markup found on the fetched page.");
    return null;
  } catch (error) {
    const fallback = buildCorsFallback(cleanUrl, context);
    if (shouldUpdateOutput) updateOutput(fallback);
    toast("Extraction failed. Run the Node server or paste HTML/schema to continue.");
    return context === "replicator" ? fallback : null;
  }
}

async function fetchHtmlForExtraction(url) {
  const res = await fetch(schemaExtractApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Extraction API returned ${res.status}`);
  return data.html;
}

function extractSchemasFromHtml(html, pageUrl = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const schemas = [];

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script, index) => {
    const text = script.textContent.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        schemas.push(...parsed);
      } else {
        schemas.push(parsed);
      }
    } catch {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "Thing",
        name: `Invalid JSON-LD block ${index + 1}`,
        rawJsonLd: text,
        extractionWarning: "Invalid JSON-LD syntax"
      });
    }
  });

  doc.querySelectorAll("[itemscope]").forEach((node, index) => {
    schemas.push(readMicrodata(node, pageUrl, index + 1));
  });

  doc.querySelectorAll("[typeof]").forEach((node, index) => {
    schemas.push(readRdfa(node, pageUrl, index + 1));
  });

  return schemas;
}

function readMicrodata(root, pageUrl, index) {
  const item = {
    "@context": "https://schema.org",
    "@type": root.getAttribute("itemtype")?.split("/").pop() || "Thing",
    url: pageUrl || undefined
  };

  root.querySelectorAll("[itemprop]").forEach((prop) => {
    const key = prop.getAttribute("itemprop");
    if (!key || prop.closest("[itemscope]") !== root && prop !== root) return;
    item[key] = extractNodeValue(prop);
  });

  return compactObject(item);
}

function readRdfa(root, pageUrl, index) {
  const item = {
    "@context": "https://schema.org",
    "@type": root.getAttribute("typeof") || "Thing",
    url: pageUrl || undefined
  };

  root.querySelectorAll("[property]").forEach((prop) => {
    const key = prop.getAttribute("property")?.split(":").pop();
    if (key) item[key] = extractNodeValue(prop);
  });

  return compactObject(item);
}

function extractNodeValue(node) {
  if (node.getAttribute("content")) return node.getAttribute("content");
  if (node.getAttribute("href")) return node.getAttribute("href");
  if (node.getAttribute("src")) return node.getAttribute("src");
  if (node.dateTime) return node.dateTime;
  return node.textContent.trim().replace(/\s+/g, " ");
}

function parseManualSchema(value) {
  const text = value.trim();
  if (!text) {
    toast("Paste schema first.");
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const wrapped = `[${text.replace(/}\s*{/g, "},{")}]`;
    try {
      return JSON.parse(wrapped);
    } catch {
      toast("Schema is not valid JSON.");
      return null;
    }
  }
}

function updateOutput(schema) {
  state.currentSchema = schema;
  dom.schemaEditor.value = schema ? JSON.stringify(schema, null, 2) : "";
  renderStructuredView(schema);
  renderValidation(schema);
  updateRichResultsLink(schema);
}

function renderStructuredView(schema) {
  if (!schema) {
    dom.structuredView.className = "structured-view empty-state";
    dom.structuredView.textContent = "No schema loaded yet.";
    return;
  }

  dom.structuredView.className = "structured-view";
  const items = flattenSchemaItems(schema);
  dom.structuredView.innerHTML = items.map((item, index) => {
    const data = item.data || item;
    const title = data["@type"] || item.source || `Schema ${index + 1}`;
    const rows = Object.entries(data)
      .slice(0, 10)
      .map(([key, value]) => `<div class="meta-row"><strong>${escapeHtml(key)}</strong>${escapeHtml(summarizeValue(value))}</div>`)
      .join("");
    return `<div class="schema-item"><h3>${escapeHtml(title)}</h3><div class="meta-grid">${rows}</div></div>`;
  }).join("");
}

function renderValidation(schema) {
  if (!schema) {
    dom.validationView.className = "validation-list empty-state";
    dom.validationView.textContent = "Run an extraction or generation to validate schema.";
    return;
  }

  const results = validateSchema(schema);
  dom.validationView.className = "validation-list";
  dom.validationView.innerHTML = results.map((item) => validationMarkup(item.status, item.title, item.message)).join("");
}

function validateSchema(schema) {
  const results = [];
  const items = flattenSchemaItems(schema).map((item) => item.data || item);

  results.push({
    status: "pass",
    title: "Valid JSON",
    message: "The editor contains parseable JSON."
  });

  items.forEach((item, index) => {
    const type = item["@type"] || "Unknown";
    const missing = ["@context", "@type", "name"].filter((field) => !item[field] && !(field === "name" && item.headline));
    const recommended = schemaDefaults[type] || ["name", "url", "description"];
    const missingRecommended = recommended.filter((field) => !item[field]);

    results.push({
      status: missing.length ? "fail" : "pass",
      title: `${type} required basics`,
      message: missing.length ? `Missing ${missing.join(", ")} in schema item ${index + 1}.` : "Core context, type, and naming fields are present."
    });

    if (missingRecommended.length) {
      results.push({
        status: "warn",
        title: `${type} recommended fields`,
        message: `Consider adding ${missingRecommended.slice(0, 5).join(", ")}.`
      });
    }
  });

  return results;
}

function validationMarkup(status, title, message) {
  return `<div class="validation-item ${status}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

function setSourceSchema(schema) {
  state.sourceSchema = schema;
  state.sourceFields = collectEditableSchemaFields(schema);
  renderReplicationSummary(schema);
  renderDynamicFieldInputs(state.sourceFields);
  toast(`Source schema ready. Created ${state.sourceFields.length} editable competitor field(s).`);
}

function renderReplicationSummary(schema) {
  const container = document.getElementById("replicationSummary");
  if (!schema) {
    container.className = "schema-map empty-state";
    container.textContent = "Extract or paste a source schema to see its shape.";
    return;
  }

  container.className = "schema-map";
  container.innerHTML = flattenSchemaItems(schema).map((item, index) => {
    const data = item.data || item;
    const keys = Object.keys(data).slice(0, 12).map((key) => `<span class="pill">${escapeHtml(key)}</span>`).join(" ");
    return `<div class="schema-item"><h3>${escapeHtml(data["@type"] || item.source || `Template ${index + 1}`)}</h3><p class="helper">Template item ${index + 1}</p><div>${keys}</div></div>`;
  }).join("");
}

function collectEditableSchemaFields(schema) {
  const fields = [];
  const seen = new Set();

  function visit(value, path = []) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, index]));
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => visit(entry, [...path, key]));
      return;
    }

    const pathKey = JSON.stringify(path);
    if (!path.length || seen.has(pathKey)) return;
    seen.add(pathKey);
    fields.push({
      path,
      label: makeFieldLabel(path),
      value,
      type: typeof value
    });
  }

  visit(schema);
  return fields.slice(0, 160);
}

function renderDynamicFieldInputs(fields) {
  const list = document.getElementById("dynamicFieldList");
  const count = document.getElementById("dynamicFieldCount");
  count.textContent = `${fields.length} field${fields.length === 1 ? "" : "s"}`;

  if (!fields.length) {
    list.className = "field-list empty-state";
    list.textContent = "No editable primitive fields were found in the source schema.";
    return;
  }

  list.className = "field-list";
  list.innerHTML = fields.map((field, index) => {
    const value = summarizeValue(field.value);
    const pathJson = escapeHtml(JSON.stringify(field.path));
    const inputType = field.type === "number" ? "number" : "text";
    return `<div class="field-item">
      <label>
        ${escapeHtml(field.label)}
        <span class="field-path">${escapeHtml(formatPath(field.path))}</span>
        <input class="dynamic-schema-field" data-field-index="${index}" data-path="${pathJson}" type="${inputType}" placeholder="${escapeHtml(value)}">
      </label>
      <p class="field-hint">Competitor value: ${escapeHtml(value || "empty")}</p>
    </div>`;
  }).join("");
}

function getDynamicFieldValues() {
  return [...document.querySelectorAll(".dynamic-schema-field")]
    .map((input) => {
      const value = input.value.trim();
      if (!value) return null;
      const field = state.sourceFields[Number(input.dataset.fieldIndex)];
      if (!field) return null;
      return {
        path: field.path,
        value: coerceFieldValue(value, field.value)
      };
    })
    .filter(Boolean);
}

function applyDynamicFieldValues(schema, fields = []) {
  fields.forEach((field) => setValueAtPath(schema, field.path, field.value));
}

function setValueAtPath(root, path, value) {
  let cursor = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor?.[path[index]];
    if (cursor === undefined || cursor === null) return;
  }
  cursor[path[path.length - 1]] = value;
}

function coerceFieldValue(value, originalValue) {
  if (typeof originalValue === "number") {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? value : numberValue;
  }
  if (typeof originalValue === "boolean") return ["true", "yes", "1"].includes(value.toLowerCase());
  if (originalValue === null && value.toLowerCase() === "null") return null;
  return value;
}

function makeFieldLabel(path) {
  const last = String(path[path.length - 1]);
  return last
    .replace(/^@/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPath(path) {
  return path.map((part, index) => (
    typeof part === "number" ? `[${part}]` : index === 0 ? part : `.${part}`
  )).join("");
}

function getBusinessData() {
  return {
    url: document.getElementById("targetUrl").value.trim(),
    name: document.getElementById("targetName").value.trim(),
    telephone: document.getElementById("targetPhone").value.trim(),
    email: document.getElementById("targetEmail").value.trim(),
    address: document.getElementById("targetAddress").value.trim(),
    description: document.getElementById("targetDescription").value.trim(),
    customFields: getDynamicFieldValues()
  };
}

function adaptSchema(schema, data) {
  const host = safeHost(data.url);
  const cloned = structuredClone(schema);
  const replacementMap = {
    name: data.name,
    legalName: data.name,
    headline: data.name,
    url: data.url,
    "@id": data.url ? `${data.url.replace(/\/$/, "")}#schema` : "",
    telephone: data.telephone,
    phone: data.telephone,
    email: data.email,
    description: data.description,
    address: data.address
  };

  function walk(value, key = "") {
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key));
    if (value && typeof value === "object") {
      Object.keys(value).forEach((childKey) => {
        if (replacementMap[childKey]) {
          value[childKey] = childKey === "address" ? makeAddress(data.address) : replacementMap[childKey];
        } else {
          value[childKey] = walk(value[childKey], childKey);
        }
      });
      return compactObject(value);
    }
    if (typeof value === "string") {
      if (key.toLowerCase().includes("url") && data.url) return data.url;
      if (value.includes("http") && data.url) return value.replace(/https?:\/\/[^/\s"]+/g, data.url.replace(/\/$/, ""));
      if (host && value.includes("@")) return data.email || value.replace(/@.+$/, `@${host}`);
    }
    return value;
  }

  const adapted = walk(cloned);
  applyDynamicFieldValues(adapted, data.customFields);
  return improveSchema(adapted);
}

function buildGeneratedSchema() {
  const type = document.getElementById("schemaType").value;
  const url = document.getElementById("generatorUrl").value.trim();
  const name = document.getElementById("generatorName").value.trim() || titleFromHost(safeHost(url)) || type;
  const phone = document.getElementById("generatorPhone").value.trim();
  const description = document.getElementById("generatorDescription").value.trim();
  const faqLines = document.getElementById("generatorFaq").value.split("\n").map((line) => line.trim()).filter(Boolean);

  const base = compactObject({
    "@context": "https://schema.org",
    "@type": type,
    name,
    headline: ["Article", "BlogPosting"].includes(type) ? name : undefined,
    url,
    description,
    telephone: phone && !type.includes("Article") && type !== "BlogPosting" && type !== "Product" ? phone : undefined,
    sku: type === "Product" ? phone : undefined
  });

  if (["LocalBusiness", "MedicalBusiness", "MedicalClinic"].includes(type)) {
    base.address = makeAddress("");
    base.openingHours = "Mo-Fr 09:00-17:00";
  }

  if (["Article", "BlogPosting"].includes(type)) {
    base.author = { "@type": "Person", name: "Editorial Team" };
    base.publisher = { "@type": "Organization", name: name || "Publisher", url };
    base.datePublished = new Date().toISOString().slice(0, 10);
  }

  if (type === "Product") {
    base.offers = compactObject({
      "@type": "Offer",
      url,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock"
    });
  }

  if (type === "FAQPage" || faqLines.length) {
    base["@type"] = type === "FAQPage" ? "FAQPage" : type;
    base.mainEntity = faqLines.map((line) => {
      const [question, answer] = line.split("|").map((part) => part?.trim());
      return {
        "@type": "Question",
        name: question || "Question",
        acceptedAnswer: {
          "@type": "Answer",
          text: answer || "Answer"
        }
      };
    });
  }

  return improveSchema(base);
}

function improveSchema(schema) {
  const cloned = structuredClone(schema);
  const items = flattenSchemaItems(cloned).map((entry) => entry.data || entry);

  items.forEach((item) => {
    item["@context"] = item["@context"] || "https://schema.org";
    if (!item.description && item.name) item.description = `${item.name} structured data profile.`;
    if (item.url && !item["@id"]) item["@id"] = `${item.url.replace(/\/$/, "")}#schema`;
    if (["Organization", "LocalBusiness", "MedicalBusiness", "MedicalClinic"].includes(item["@type"]) && !item.logo && item.url) {
      item.logo = `${item.url.replace(/\/$/, "")}/logo.png`;
    }
    if (item["@type"] === "FAQPage" && Array.isArray(item.mainEntity)) {
      item.mainEntity = item.mainEntity.filter((faq) => faq.name && faq.acceptedAnswer?.text);
    }
  });

  return cloned;
}

async function handleSitemapUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  await generateSitemapSchemasFromText(text, file.name);
}

async function handleSitemapUrlSubmit(event) {
  event.preventDefault();
  const sitemapUrl = normalizeUrl(document.getElementById("sitemapUrl").value);
  if (!sitemapUrl) return toast("Enter a valid sitemap URL.");

  try {
    toast("Fetching sitemap URL.");
    const text = await fetchHtmlForExtraction(sitemapUrl);
    await generateSitemapSchemasFromText(text, sitemapUrl);
  } catch {
    toast("Could not fetch that sitemap URL. Check the URL or upload the XML file.");
  }
}

async function generateSitemapSchemasFromText(text, sourceUrl = "") {
  const urls = await getUrlsFromSitemapText(text);
  if (!urls.length) {
    renderSitemapSummary([], []);
    toast("No page URLs found in that sitemap.");
    return;
  }

  const businessName = document.getElementById("targetName").value.trim() || safeHost(urls[0]) || titleFromHost(safeHost(sourceUrl)) || "Website";
  state.sitemapSchemas = urls.map((url) => createSchemaForUrl(url, businessName));
  updateOutput(state.sitemapSchemas);
  renderSitemapSummary(urls, state.sitemapSchemas);
  toast(`Generated ${state.sitemapSchemas.length} sitemap schema drafts.`);
}

async function getUrlsFromSitemapText(text, depth = 0) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  const pageUrls = [...xml.querySelectorAll("url > loc")]
    .map((node) => node.textContent.trim())
    .filter((url) => normalizeUrl(url));

  if (pageUrls.length || depth >= 1) return pageUrls.slice(0, 250);

  const childSitemaps = [...xml.querySelectorAll("sitemap > loc")]
    .map((node) => node.textContent.trim())
    .filter((url) => normalizeUrl(url))
    .slice(0, 8);

  const childResults = [];
  for (const childUrl of childSitemaps) {
    try {
      const childText = await fetchHtmlForExtraction(childUrl);
      childResults.push(...await getUrlsFromSitemapText(childText, depth + 1));
    } catch {
      // Ignore individual child sitemap failures so one blocked file does not break the batch.
    }
  }

  return [...new Set(childResults)].slice(0, 250);
}

function createSchemaForUrl(url, businessName) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.includes("blog") || path.includes("article")) {
    return improveSchema({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: titleFromPath(path) || businessName,
      url,
      author: { "@type": "Organization", name: businessName },
      publisher: { "@type": "Organization", name: businessName },
      datePublished: new Date().toISOString().slice(0, 10)
    });
  }

  if (path.includes("contact")) {
    return improveSchema({ "@context": "https://schema.org", "@type": "ContactPage", name: "Contact", url });
  }

  if (path.includes("about")) {
    return improveSchema({ "@context": "https://schema.org", "@type": "AboutPage", name: `About ${businessName}`, url });
  }

  if (path.includes("service")) {
    return improveSchema({ "@context": "https://schema.org", "@type": "Service", name: titleFromPath(path) || "Service", provider: { "@type": "Organization", name: businessName }, url });
  }

  return improveSchema({ "@context": "https://schema.org", "@type": "WebPage", name: path === "/" ? businessName : titleFromPath(path), url });
}

function renderSitemapSummary(urls, schemas) {
  const container = document.getElementById("sitemapSummary");
  if (!urls.length) {
    container.className = "sitemap-list empty-state";
    container.textContent = "No URLs found in that sitemap.";
    return;
  }

  container.className = "sitemap-list";
  container.innerHTML = schemas.slice(0, 12).map((schema) => (
    `<div class="sitemap-item"><h3>${escapeHtml(schema["@type"])}</h3><p>${escapeHtml(schema.url)}</p></div>`
  )).join("");
}

function compareSchemas() {
  const a = parseManualSchema(document.getElementById("compareA").value);
  const b = parseManualSchema(document.getElementById("compareB").value);
  const output = document.getElementById("diffView");
  if (!a || !b) return;

  const flatA = flattenObject(a);
  const flatB = flattenObject(b);
  const keys = [...new Set([...Object.keys(flatA), ...Object.keys(flatB)])].sort();
  const rows = keys
    .filter((key) => JSON.stringify(flatA[key]) !== JSON.stringify(flatB[key]))
    .map((key) => {
      const type = !(key in flatA) ? "added" : !(key in flatB) ? "removed" : "changed";
      return `<div class="diff-row ${type}"><strong>${escapeHtml(key)}</strong><p>${escapeHtml(summarizeValue(flatA[key]))} -> ${escapeHtml(summarizeValue(flatB[key]))}</p></div>`;
    });

  output.className = rows.length ? "diff-view" : "diff-view empty-state";
  output.innerHTML = rows.length ? rows.join("") : "Schemas match after normalization.";
}

function saveCurrentSchema() {
  if (!state.currentSchema) return toast("Load or generate schema before saving.");
  const item = {
    id: crypto.randomUUID(),
    name: getSchemaTitle(state.currentSchema),
    createdAt: new Date().toISOString(),
    schema: state.currentSchema
  };
  state.savedSchemas.unshift(item);
  localStorage.setItem("schemaStudioSaved", JSON.stringify(state.savedSchemas.slice(0, 20)));
  renderSavedSchemas();
  toast("Schema saved locally.");
}

function renderSavedSchemas() {
  const container = document.getElementById("savedSchemas");
  if (!state.savedSchemas.length) {
    container.className = "saved-list empty-state";
    container.textContent = "No saved schemas yet.";
    return;
  }

  container.className = "saved-list";
  container.innerHTML = state.savedSchemas.map((item) => (
    `<div class="saved-item">
      <h3>${escapeHtml(item.name)}</h3>
      <p class="helper">${new Date(item.createdAt).toLocaleString()}</p>
      <button class="ghost-btn" data-load-schema="${item.id}" type="button">Load</button>
    </div>`
  )).join("");

  container.querySelectorAll("[data-load-schema]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.savedSchemas.find((schema) => schema.id === button.dataset.loadSchema);
      if (item) {
        updateOutput(item.schema);
        document.querySelector('[data-section="extract"]').click();
        toast("Saved schema loaded.");
      }
    });
  });
}

function copyCurrentSchema() {
  if (!dom.schemaEditor.value.trim()) return toast("Nothing to copy yet.");
  navigator.clipboard.writeText(dom.schemaEditor.value)
    .then(() => toast("Schema copied to clipboard."))
    .catch(() => toast("Clipboard permission was blocked."));
}

function downloadCurrentSchema(type) {
  if (!state.currentSchema) return toast("Nothing to download yet.");
  const extension = type === "json" ? "json" : "txt";
  const mime = type === "json" ? "application/json" : "text/plain";
  const blob = new Blob([JSON.stringify(state.currentSchema, null, 2)], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `schema-studio-${Date.now()}.${extension}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateRichResultsLink(schema) {
  const url = getFirstUrl(schema);
  dom.richResultsLink.href = url
    ? `https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`
    : "https://search.google.com/test/rich-results";
}

function getAssistantReply(message) {
  const lower = message.toLowerCase();
  if (lower.includes("local") || lower.includes("business")) return "For LocalBusiness, prioritize name, address, phone, URL, opening hours, geo, logo, sameAs links, and a precise business category.";
  if (lower.includes("faq")) return "FAQPage needs mainEntity questions with acceptedAnswer text. Keep each answer visible on the page you mark up.";
  if (lower.includes("product")) return "Product schema is strongest with image, brand, SKU, offers, priceCurrency, availability, and reviews only when they are genuine on-page content.";
  if (lower.includes("error") || lower.includes("valid")) return "Use the Validation tab for local checks, then open Rich Results Test for Google-specific eligibility.";
  return "A practical rule: describe what is visibly present on the page, keep identifiers stable, and use the most specific Schema.org type that honestly fits.";
}

function addChat(role, text) {
  const chat = document.getElementById("chatBox");
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
}

function buildCorsFallback(url, context) {
  const host = safeHost(url) || "Example Website";
  return improveSchema({
    "@context": "https://schema.org",
    "@type": context === "replicator" ? "Organization" : "WebPage",
    name: titleFromHost(host),
    url,
    description: "Direct extraction was blocked by browser CORS. Paste HTML or JSON-LD for exact extraction.",
    extractionStatus: "blocked-by-cors"
  });
}

function flattenSchemaItems(schema) {
  if (!schema) return [];
  if (Array.isArray(schema)) return schema.flatMap((item) => flattenSchemaItems(item));
  if (schema["@graph"] && Array.isArray(schema["@graph"])) return schema["@graph"];
  if (schema.data) return flattenSchemaItems(schema.data);
  return [schema];
}

function flattenObject(obj, prefix = "", output = {}) {
  if (Array.isArray(obj)) {
    obj.forEach((value, index) => flattenObject(value, `${prefix}[${index}]`, output));
    return output;
  }
  if (obj && typeof obj === "object") {
    Object.entries(obj).forEach(([key, value]) => flattenObject(value, prefix ? `${prefix}.${key}` : key, output));
    return output;
  }
  output[prefix] = obj;
  return output;
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== ""));
}

function makeAddress(address) {
  if (!address) return { "@type": "PostalAddress" };
  return {
    "@type": "PostalAddress",
    streetAddress: address
  };
}

function summarizeValue(value) {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function getSchemaTitle(schema) {
  const first = flattenSchemaItems(schema)[0] || {};
  const data = first.data || first;
  return data.name || data.headline || data["@type"] || "Saved schema";
}

function getFirstUrl(schema) {
  const first = flattenSchemaItems(schema).map((item) => item.data || item).find((item) => item.url);
  return first?.url || "";
}

function normalizeUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol.startsWith("http") ? url.href : "";
  } catch {
    return "";
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleFromHost(host) {
  return host.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function titleFromPath(path) {
  const last = path.split("/").filter(Boolean).pop() || "";
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove("visible"), 3200);
}
