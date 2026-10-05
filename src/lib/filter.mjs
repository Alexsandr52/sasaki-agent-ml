// Нормализация: нижний регистр, ё→е, дефисы/слэши → пробел.
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[-–—/|,()«»"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Эквиваленты грейдов и близких инженерных ролей.
const SYNONYM_PAIRS = [
  ["исследователь", "researcher"], ["учёный", "scientist"],
  // грейды и руководство — вся лестница
  ["стажер", "intern"], ["стажер", "trainee"],
  ["младший", "junior"], ["джуниор", "junior"],
  ["мидл", "middle"],
  ["старший", "senior"], ["сеньор", "senior"],
  ["ведущий", "lead"], ["лид", "lead"],
  ["стафф", "staff"], ["главный", "principal"], ["главный", "chief"],
  ["эксперт", "expert"],
  ["руководитель", "head"], ["глава", "head"], ["директор", "director"],
  ["менеджер", "manager"],
  ["машинное обучение", "machine learning"],
  // Эти пары нужны, чтобы стоп-слова одинаково действовали на русском и английском.
  ["аналитик", "analyst"], ["разработчик", "developer"],
  ["инженер", "engineer"], ["тестировщик", "qa"],
  ["маркетолог", "marketer"], ["рекрутер", "recruiter"],
];

const SYNONYMS = new Map();
for (const [a, b] of SYNONYM_PAIRS) {
  SYNONYMS.set(a, (SYNONYMS.get(a) || new Set()).add(b));
  SYNONYMS.set(b, (SYNONYMS.get(b) || new Set()).add(a));
}

// Слово ключевой фразы + его эквиваленты. Словарь ищется по префиксу, чтобы
// русские окончания и формы слов не мешали совпадению.
function variants(word) {
  const out = new Set([word]);
  for (const [key, set] of SYNONYMS) {
    if (word.startsWith(key) || key.startsWith(word)) {
      for (const v of set) out.add(v);
    }
  }
  for (const v of [...out]) {
    for (const v2 of SYNONYMS.get(v) || []) out.add(v2);
  }
  return [...out];
}

// Кириллица сравнивается по префиксу (падежи), латиница — точно или с плюралом,
// но не по префиксу: иначе "ml" матчил бы лишние слова.
function wordHits(w, v) {
  return /^[a-z0-9]/.test(v) ? w === v || w === v + "s" : w.startsWith(v);
}

// Ключевая фраза совпадает, если каждое её слово (или эквивалент) есть в заголовке.
function keywordMatches(titleWords, keyword) {
  return normalize(keyword)
    .split(" ")
    .every((kw) => variants(kw).some((v) => titleWords.some((w) => wordHits(w, v))));
}

export function matches(title, { keywords, stopwords }) {
  const norm = normalize(title);
  // однословные стоп-слова расширяются словарём («аналитик» режет и analyst)
  const stopped = stopwords.some((sw) => {
    const s = normalize(sw);
    const forms = s.includes(" ") ? [s] : variants(s);
    return forms.some((f) => norm.includes(f));
  });
  if (stopped) return false;
  return matchesKeywords(norm, keywords);
}

// Только ключевые слова, без стоп-слов — для длинных текстов (посты каналов),
// где одно упоминание стоп-слова не должно топить весь пост.
export function matchesKeywords(text, keywords) {
  const words = normalize(text).split(" ");
  return keywords.some((kw) => keywordMatches(words, kw));
}

// --- Структурные критерии: грейд и формат работы -----------------------------
// Канонические грейды. Слово названия сводится к грейду по префиксу.
const GRADE_WORDS = {
  стажер: "intern", intern: "intern", trainee: "intern",
  младший: "junior", джун: "junior", junior: "junior",
  мидл: "middle", миддл: "middle", middle: "middle",
  старший: "senior", сеньор: "senior", синьор: "senior", senior: "senior",
  ведущий: "lead", лид: "lead", lead: "lead", тимлид: "lead",
  стафф: "staff", staff: "staff", эксперт: "senior", expert: "senior", teamlead: "lead",
  главный: "principal", principal: "principal", chief: "principal",
  руководитель: "head", глава: "head", head: "head",
  директор: "director", director: "director",
};

// Все грейды, упомянутые в тексте: «Middle/Senior Engineer» → [middle, senior].
export function inferGrades(text) {
  const found = new Set();
  for (const w of normalize(text).split(" ")) {
    for (const [key, grade] of Object.entries(GRADE_WORDS)) {
      if (w.startsWith(key)) found.add(grade);
    }
  }
  return [...found];
}

function sourceGrades(item) {
  return [...new Set([
    item.level, item.grade, item.gradeTitle, item.experienceLevel, item.experienceTitle,
  ].filter(Boolean).flatMap((text) => inferGrades(String(text))))];
}

function explicitTextGrades(item) {
  const text = [item.requirements, item.description, item.snippet].filter(Boolean).join("\n");
  const out = new Set();
  for (const part of text.split(/[\n.!?;]+/)) {
    const grades = inferGrades(part);
    if (!grades.length) continue;
    if (/(grade|level|уровень|грейд|позиция|в поиске|ищем|ищет|looking for|hiring)/i.test(part)) {
      for (const grade of grades) out.add(grade);
      continue;
    }
    if (/^(intern|junior|middle|senior|lead|staff|principal|head|director|стажер|младший|мидл|старший|ведущий)(?:\s*\+)?$/i.test(part.trim())) {
      for (const grade of grades) out.add(grade);
    }
  }
  return [...out];
}

function inactive(item) {
  if (item.opportunityType === "internship_program" && item.availability !== "active") return true;
  return /^(closed|inactive|expired|закрыт)$/i.test(String(item.availability || item.status || "").trim());
}

const DIRECTION_KEYWORDS = {
  "ml ai engineer": ["machine learning engineer", "ml engineer", "ml developer", "ml разработчик", "ml стажировка", "ml стажер", "ml специалист", "mlops engineer", "deep learning engineer", "ai developer", "ai engineer", "data scientist", "data science", "machine learning research engineer", "ml researcher", "computer vision researcher", "искусственный интеллект", "машинного обучения", "машинное обучение", "науки о данных", "исследователь машинного обучения"],
  "computer vision engineer": ["computer vision engineer", "computer vision researcher", "cv engineer", "cv researcher", "computer vision intern", "специалист компьютерного зрения", "инженер компьютерного зрения", "машинного зрения", "исследователь компьютерного зрения"],
  "nlp llm engineer": ["nlp engineer", "llm engineer", "nlp researcher", "llm researcher", "nlp разработчик", "llm разработчик", "генеративный ии", "обработки естественного языка", "языковых моделей", "исследователь nlp"],
};

// Эффективный список ключевых слов роли: направления, раскрытые в матчащиеся
// слова, плюс явные ключевые слова пользователя. Используется и структурным
// фильтром, и телеграм-источником (он матчит по полному тексту поста).
export function roleKeywords(cfg) {
  const expanded = (cfg.directions || []).flatMap((d) => DIRECTION_KEYWORDS[normalize(d)] || [d]);
  return [...new Set([...expanded, ...(cfg.keywords || [])])];
}

// Не исключаем оплачиваемую стажировку только из-за неполной занятости.
function gigOk(item) {
  const title = normalize(`${item.title || ""} ${item.level || ""} ${item.employmentType || ""}`);
  if (/consult|консульт|фриланс|freelance/.test(title)) return false;
  if (/part time|парт тайм|частичн\w{0,3} занятост/.test(title)
      && !/intern|стажер|стажировк/.test(title)) return false;
  return true;
}

const FORMAT_WORDS = {
  remote: ["удален", "remote", "дистанц"],
  hybrid: ["гибрид", "hybrid"],
  office: ["офис", "office", "onsite", "on site"],
};

// Явное минимальное требование к опыту. Большинство карточек источников не
// содержит описания, но часть адаптеров передаёт его или опыт в location/level.
export function minimumExperienceYears(item) {
  const found = [];
  if (item.experienceMin != null && item.experienceMin !== "" && Number.isFinite(Number(item.experienceMin))) {
    found.push(Number(item.experienceMin));
  }
  const code = String(item.experience || "").toLowerCase();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (code === "no_experience") found.push(0);
  if (code === "year_minimum" || code === "one_year_minimum") found.push(1);
  const enumYears = code.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)_years?_(?:more|minimum)$/);
  if (enumYears) found.push(Number(enumYears[1]) || words[enumYears[1]]);
  let text = [item.experience, item.experience_type_title, item.requirements,
    item.description, item.snippet, item.level, item.location].filter(Boolean).join("\n")
    .replace(/<\/?(?:li|p|br|div|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").toLowerCase().replaceAll("ё", "е");
  const ruNumbers = { одного: 1, один: 1, одной: 1, одна: 1, двух: 2, два: 2, две: 2,
    трех: 3, три: 3, четырех: 4, четыре: 4, пяти: 5, пять: 5, шести: 6, шесть: 6,
    семи: 7, семь: 7, восьми: 8, восемь: 8, девяти: 9, девять: 9, десяти: 10, десять: 10, ...words };
  text = text.replace(new RegExp(`(?<![a-zа-я])(${Object.keys(ruNumbers).join("|")})(?=\\s+(?:лет|год|year|yr))`, "g"), (m) => String(ruNumbers[m]));
  if (/без опыта|опыт (?:работы )?не (?:требуется|обязателен)|no (?:work )?experience required/.test(text)) found.push(0);
  // Preserve ranges: '1–3 года' means a minimum of one, not three.
  for (const part of text.split(/\n|;|[.!?](?!\d)/)) {
    if (/желательно|будет плюсом|как плюс|preferred|nice to have|as a plus/.test(part)) continue;
    const re = /(?<![\d.,])(?:от\s*|не менее\s*|минимум\s*|более\s*)?(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*\d+|\s+до\s+\d+)?\s*\+?\s*(?:лет|года?|years?|yrs?)(?![a-zа-я])/gi;
    for (const m of part.matchAll(re)) {
      const context = part.slice(Math.max(0, m.index - 80), m.index + m[0].length + 50);
      const structured = [item.experience, item.experience_type_title].some((v) => v && String(v).toLowerCase().includes(part.trim()));
      if (/опыт|experience|стаж/.test(context) || /\+/.test(m[0]) || /^(от|не менее|минимум|более)/.test(m[0]) || structured) {
        found.push(Number(m[1].replace(",", ".")));
      }
    }
  }
  // Multiple mandatory requirements must all hold (one year Python and three
  // years ML cannot be reduced to one year). Structured metadata is not allowed
  // to erase stricter explicit requirements in the body.
  return found.length ? Math.max(...found) : null;
}

// cfg.grades: пусто/нет = любые. Грейд берём из метаданных источника, затем
// из заголовка. Для поиска только intern/junior вакансии с неизвестным грейдом
// скрываем: источники без описания иначе пропускают вакансии с опытом 2+ лет.
function gradeOk(item, grades) {
  if (!grades?.length) return true;
  const entryOnly = grades.every((g) => g === "intern" || g === "junior");
  const minYears = minimumExperienceYears(item);
  if (entryOnly && minYears !== null && minYears >= 2) return false;
  const source = sourceGrades(item);
  const found = source.length ? source : inferGrades(item.title);
  // Метаданные уровня от работодателя приоритетнее заголовка, который может
  // содержать «младший» по названию направления, но Middle в карточке.
  if (entryOnly && source.some((g) => !["intern", "junior"].includes(g))) return false;
  // Неизвестный грейд/опыт оставляем кандидатом для проверки по полному
  // описанию. Иначе источники с короткими карточками теряют подходящие роли.
  if (!found.length) return true;
  return found.some((g) => grades.includes(g));
}

export function assessItem(item, cfg) {
  const dirs = cfg.directions || [];
  const roleText = item.prefiltered
    ? `${item.title || ""} ${item.snippet || item.description || ""}`
    : item.level ? `${item.title || ""} ${item.level}` : item.title;
  const role = dirs.length
    ? matches(roleText, { keywords: roleKeywords(cfg), stopwords: cfg.stopwords || [] })
    : matches(roleText, cfg);
  const bodyYears = minimumExperienceYears(item);
  const categoryYears = minimumExperienceYears({ experience: item.experienceCategory || "" });
  const entryException = /(?:готовы?\s+рассмотр|рассмотрим|можно|допуска|welcome|consider)[^.\n]{0,160}(?:меньш|без опыта|pet.?проект|less experience|no experience)/i.test([item.requirements, item.description].filter(Boolean).join("\n"));
  const categoryConflict = categoryYears >= 2 && entryException && (bodyYears === null || bodyYears < 2);
  const knownYears = [bodyYears, categoryYears].filter((value) => value !== null);
  const years = categoryConflict ? bodyYears : knownYears.length ? Math.max(...knownYears) : null;
  const titleGrades = inferGrades(item.title || "");
  const source = sourceGrades(item);
  const bodyGrades = explicitTextGrades(item);
  const grades = source.length ? source : titleGrades;
  const entryOnly = (cfg.grades || []).length > 0
    && (cfg.grades || []).every((g) => g === "intern" || g === "junior");
  const isEntry = (g) => ["intern", "junior"].includes(g);
  const mixedTitle = !source.length && titleGrades.some(isEntry) && titleGrades.some((g) => !isEntry(g));
  const explicitSenior = entryOnly && (source.length ? source.some((g) => !isEntry(g)) : grades.length > 0 && grades.every((g) => !isEntry(g)));
  const hardExperience = entryOnly && years !== null && years >= 2;
  const closed = inactive(item);
  const structural = structuralOk(item, cfg);
  const bodyConflict = entryOnly && bodyGrades.some((g) => !["intern", "junior"].includes(g))
    && titleGrades.some((g) => ["intern", "junior"].includes(g));
  const review = role && !hardExperience && (bodyConflict || years === null || (!grades.length && entryOnly && years !== 0));
  let decision = "suitable";
  const reasons = [];
  if (closed) { decision = "excluded"; reasons.push(item.opportunityType === "internship_program" && item.availability === "unknown" ? "открытый набор не подтверждён" : "набор закрыт"); }
  else if (!role) { decision = "excluded"; reasons.push("название не совпало с ML-направлениями"); }
  else if (hardExperience) { decision = "excluded"; reasons.push(`требуется опыт ${years}+ лет`); }
  else if (explicitSenior) { decision = "excluded"; reasons.push(`грейд ${grades.join(", ")} вне выбранного диапазона`); }
  else if (entryOnly && categoryConflict) { decision = "review"; reasons.push(`категория опыта ${item.experienceCategory} противоречит готовности рассмотреть меньший опыт`); }
  else if (entryOnly && mixedTitle) { decision = "review"; reasons.push(`вакансия указана для нескольких уровней: ${titleGrades.join("/")}`); }
  else if (bodyConflict) { decision = "review"; reasons.push(`заголовок ${titleGrades.join("/")} противоречит требованиям ${bodyGrades.join("/")}`); }
  else if (entryOnly && !titleGrades.length && !source.length && bodyGrades.some((g) => !["intern", "junior"].includes(g))) {
    decision = "excluded"; reasons.push(`в требованиях указан грейд ${bodyGrades.join(", ")}`);
  }
  else if (!gradeOk(item, cfg.grades)) {
    decision = "excluded";
    const source = sourceGrades(item);
    reasons.push(`грейд ${source.length ? source.join("/") : inferGrades(item.title).join("/")} вне выбранного диапазона`);
  }
  else if (!formatOk(item, cfg.formats)) { decision = "excluded"; reasons.push("формат не входит в выбранные фильтры"); }
  else if (!gigOk(item)) { decision = "excluded"; reasons.push("консультационная, фриланс или неподходящая частичная занятость"); }
  else if (!structural) { decision = "excluded"; reasons.push("не прошли выбранные структурные фильтры"); }
  else if (review) { decision = "review"; reasons.push(years === null ? "опыт в карточке источника не указан" : "грейд требует проверки"); }
  return { decision, reasons, experienceYears: years, roleMatch: role };
}

// cfg.formats: ["remote","hybrid","office"] — пусто/нет = любые. Смотрим
// item.format + location + title; формат не упомянут — не режем.
function formatOk(item, formats) {
  if (!formats?.length) return true;
  const hay = normalize([item.format, item.location, item.title].filter(Boolean).join(" "));
  const present = Object.entries(FORMAT_WORDS)
    .filter(([, words]) => words.some((w) => hay.includes(w)))
    .map(([name]) => name);
  if (!present.length) return true;
  return present.some((f) => formats.includes(f));
}

// Полная проверка вакансии: ключевые слова + стоп-слова + грейд + формат.
//
// Если выбраны направления (cfg.directions), роль определяется ЧИСТЫМ
// заголовком: он должен матчить направление или фразу уровня, а грейд режет
// структурный фильтр gradeOk. Склеивать title+level здесь нельзя: у hirehi
// level=lead, и «коммуникационный дизайнер» превращался в «дизайн лида»
// (слова фразы добирались из level).
//
// Без направлений keywords матчатся по title + item.level: у многих карьерных
// сайтов грейд лежит отдельным полем (теги Т-Банка, level hirehi), а заголовок —
// просто «Продуктовый дизайнер»; без level такие вакансии не отобрать.
export function matchesItem(item, cfg) {
  return assessItem(item, cfg).decision !== "excluded";
}

// Только структурные срезы, без ключевых слов — для prefiltered-источников
// (телеграм матчит ключевые слова по полному тексту поста сам, но грейд,
// область, формат и тип найма режутся по извлечённому заголовку здесь).
export function structuralOk(item, cfg) {
  return !inactive(item) && gradeOk(item, cfg.grades) && formatOk(item, cfg.formats) && gigOk(item);
}

// --- Межисточниковый дедуп ---------------------------------------------------
// Одна вакансия часто приходит и из прямого источника (hh, hirehi), и из
// телеграм-поста, который на неё ссылается. Ключ дедупа — целевая ссылка
// (applyUrl приоритетнее url) без протокола, www, трекинг-параметров и хвоста.
const TRACKING = /\b(utm_[a-z]+|rcm|ref|fbclid|gclid|yclid|_ga|share|origin)=[^&]*/gi;

export function targetKey(item) {
  const raw = item.applyUrl || item.url || "";
  const stripped = raw.toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/#.*$/, "")
    .replace(TRACKING, "")
    .replace(/[?&]+$/, "").replace(/\/+$/, "");
  return stripped || `${item.source}:${item.id}`; // нет ссылки — не сливаем
}

// Текстовый ключ для телеграм-постов БЕЗ внешней ссылки: один и тот же пост в
// двух каналах имеет разные t.me-url, по ссылке его не схлопнуть. Ключ —
// нормализованные заголовок+компания; короткие générique-заголовки («Дизайнер»)
// не сливаем, чтобы не склеить разные вакансии.
export function textKey(item) {
  if (item.source !== "telegram" || item.applyUrl) return "";
  const t = normalize(item.title);
  if (t.length < 20) return "";
  return `txt:${t}|${normalize(item.company || "")}`;
}

// Убрать дубли по целевой ссылке. При совпадении предпочитаем прямой источник
// (у него структурные поля: грейд, зарплата) телеграм-посту.
export function dedupeByTarget(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = targetKey(item);
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, item); continue; }
    const prevTg = prev.source === "telegram";
    const curTg = item.source === "telegram";
    if (prevTg && !curTg) byKey.set(key, item); // прямой источник вытесняет телегу
  }
  // второй проход: дубли одного поста в разных каналах (по тексту)
  const byText = new Map();
  const out = [];
  for (const item of byKey.values()) {
    const tk = textKey(item);
    if (tk) {
      if (byText.has(tk)) continue;
      byText.set(tk, item);
    }
    out.push(item);
  }
  return out;
}
