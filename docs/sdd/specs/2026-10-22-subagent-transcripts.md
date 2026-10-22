# console-log — транскрипти субагентів у панелі — design

**Date:** 2026-10-22
**Status:** agreed
**Prototype:** docs/sdd/proto/subagent-tab/decision.md

## 1. Problem

Панель console-log показує вивід фонових задач Bash і Monitor. Субагентів (`Agent`, `fork`, вкладені агенти) у ній немає, тож те, що робить субагент, людина не бачить:
- foreground-субагент блокує чат, і поки він працює, видно лише рядок прогресу;
- фоновий субагент видно тільки в `/tasks`: назва і статус, без тексту;
- щоб подивитися хід роботи, доводиться перемикати головний вигляд на транскрипт агента, і тоді губиться розмова.

Ще й Bash, запущений *всередині* субагента, мод навмисно пропускає (`e.agentId !== undefined` у `tool.call`), тож його виводу в панелі теж немає.

## 2. Constraint that shapes the solution

Рушій уже веде повний транскрипт кожного агента і віддає його моду. Тому мод нічого не накопичує сам, а читає готове:

- **Старт.** Хук `agent.spawn` після `next(e)` отримує `AgentSpawnResult.agentId`. Він спрацьовує для будь-якого агента, зокрема вкладеного, а агент воркфлоу без локального циклу `agentId` не має.
- **Статус.** `$.agent.list()` повертає `AgentInfo.status`: `pending | running | waiting | idle | completed | failed | killed`. Окремої події завершення субагента, яку мод отримав би так само надійно, як `<task-notification>`, немає. Рушій прибирає агента зі списку «згодом».
- **Текст.** `$.session.messages({ agentId })` повертає до 4096 `SessionMessage` агента разом із `toolUses[]` (`tool`, `input`, `text`, `isError`), а на нечитабельний id — `{ deny }`.

Відкинуто:
- **Накопичення з `session.append`.** Це другий стан поряд зі станом рушія, і все, що сталося до завантаження мода, губиться.
- **Читання `subagents/agent-<id>.jsonl` через `tail`.** Формат файлу недокументований.
- **Перемикання головного вигляду через `$.ui.view`.** Користувач хоче бачити агента так само, як логи процесів: у панелі, не покидаючи розмови.

## 3. Solution

### 3.1 Модель

`types/index.d.ts`: `ConsoleTask.kind` стає `'shell' | 'monitor' | 'agent'`. Агент — звичайна задача в тому самому `Board`:

| поле | значення для агента |
|---|---|
| `id` | `agentId` |
| `command` | `` `${subagentType}: ${description}` `` (нижня рамка) |
| `label` | `` `${subagentType}·${description}` `` (вкладка, обрізається до `LABEL_MAX = 22`) |
| `path` | відсутнє |
| `startedAt` | `$.clock.now()` у момент спаву |

`addTask`, `dropTask`, `selectTask`, `MAX_TASKS = 20`, `tabWindow`, правило `viewed` і закриття панелі без задач не змінюються.

### 3.2 Старт — `hooks/register.tsx`

`on('agent.spawn', …)` → `const r = await next(e)`. Якщо є `r.agentId`, викликається `track($, { id: r.agentId, kind: 'agent', command, label }, undefined)` без очікування, а хук повертає `r`. `track` для `kind === 'agent'` не шукає вихідний файл (`findOutput`). Хук обгортається `.catch(($, e, next) => next(e))`. `subagentType` і `description` проходять через `clean()`, як і зараз.

### 3.3 Статус — `hooks/tasks.ts`

Нова чиста функція `syncAgents(board: Board, infos: readonly { id: string; status: string }[]): Board`. Для кожної задачі `kind === 'agent'` без `status`:
- `completed`, `failed`, `killed` → цей статус, `viewed: false`;
- агента немає в `infos` → `killed`;
- інше (`pending`, `running`, `waiting`, `idle`) → без змін.

Інші задачі вона не чіпає, а якщо змін немає, повертає той самий `board` (за посиланням).

`poll()` перед `expireTasks` викликає `$.agent.list()` (виняток → цей крок пропускається) і `mutate($, b => syncAgents(b, infos))`. Для кожного агента, що щойно став `completed`, плануємо `drop` через `DROP_COMPLETED_MS = 10000`, як для `<task-notification>`. `failed` і `killed` лишаються до перегляду (наявне правило `viewed`). `hasRunning` розглядає агента без статусу як задачу, що виконується, тож таймер працює, доки агент живий.

### 3.4 Текст — `hooks/transcript.ts` (новий)

`agentLines(messages: readonly SessionMessage[]): OutLine[]`, чиста функція, де `OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }` (тип у `types/index.d.ts`):
- перше повідомлення `user`: `▸ <перший рядок text>` (`muted`); решта `user`-повідомлень пропускаються;
- `assistant.text`: рядок за рядком (`text`); кілька порожніх рядків підряд згортаються в один, крайні порожні рядки прибираються;
- кожен `toolUses[i]` → `→ <tool>: <arg>` (`tool`):
  - `tool`: `mcp__<server>__<name>` → `<server>:<name>`;
  - `arg`: перше рядкове значення з `command`, `file_path`, `pattern`, `path`, `url`, `query`, `description`, `prompt`, інакше перше рядкове значення `input`, інакше `''`;
- під тулом:
  - `text === undefined` → `  …` (`muted`);
  - інакше непорожні рядки `text`: перші `RESULT_LINES = 3` з префіксом `  ` (`result`); при `isError` перший іде з префіксом `  ✗ ` (`error`); якщо рядків більше — `  … +N lines` (`muted`).

Результат — останні `LINES = 200` рядків. `register.tsx` пропускає кожен `text` через `sanitize` і обрізає до `LINE_MAX = 500`, як вивід shell.

Атом `lines` стає `OutLine[]` для всіх задач: рядки shell і Monitor мають `tone: 'text'`.

### 3.5 Читання — `load()` у `hooks/register.tsx`

Для вибраної задачі `kind === 'agent'`: `$.session.messages({ agentId: task.id })`. Масив → `lines = agentLines(...)`, `readFailed = false`. `{ deny }` або виняток → `readFailed = true`, попередні `lines` лишаються. Читається лише вибрана вкладка. `pathMissing` для агента завжди `false`.

### 3.6 Рендер

- Вкладка: як у shell (`mark`, `tabLabel`, `age`).
- Верхня рамка тіла: `TRANSCRIPT` для агента, `OUTPUT` для інших. Праворуч `statusText(task)`, а при `readFailed` — `· transcript unavailable` для агента і `· file unavailable` для інших.
- Нижня рамка: `task.command`.
- Кольори рядків за `tone` (з прототипу): `tool` — `cyan`; `result` і `muted` — dim; `error` — `red`; `text` — без стилю. Рядок `tool` можна малювати одним кольором: жирне ім'я тулу з прототипу необов'язкове.
- Рядок з `missing` (`output file not found`) лишається dim, як зараз.

### 3.7 Версія і документація

`.claude-plugin/plugin.json` `version`: `0.1.2` → `0.2.0`, `description` згадує субагентів. `README.md` (англійська та українська частини): у «Behaviour» — вкладки субагентів і що в них видно; у «Limits» — 3 рядки результату тулу, агенти воркфлоу не показуються.

## 4. Out of scope

- Прокрутка тексту в панелі.
- Перемикання головного вигляду (`$.ui.view`), відправка повідомлень агенту.
- Teammates в окремих терміналах і агенти воркфлоу.
- Thinking-блоки та повний вивід результатів тулів.
- Окремі вкладки для Bash/Monitor, запущених усередині субагента: фільтр `e.agentId !== undefined` лишається.

## 5. Trade-offs accepted

- Щосекунди перечитується весь транскрипт вибраного агента (до 4096 повідомлень) — O(n) на тік, але лише для однієї вкладки. Натомість немає власного стану, що міг би розійтися з рушієм.
- Результат тулу зрізано до 3 рядків: панель без прокрутки, і великий `Read` інакше витіснив би все інше.
- Агент, якого рушій прибрав зі списку без кінцевого статусу, показується як `killed` (■), навіть якщо насправді завершився. Без цього вкладка висіла б вічно.
- Мітка `Type·description` часто обрізається на 22 символах.
- Агенти рахуються в `MAX_TASKS = 20` разом із задачами. Під час великого фан-ауту старі вкладки витісняються.

## 6. Verification

- `claude plugin test .`:
  - `hooks/transcript.test.ts` — `agentLines`: промпт, текст і згортання порожніх рядків, тул з аргументом, MCP-ім'я, 3 рядки + `… +N lines`, `isError`, тул у процесі, ліміт 200, тон кожного виду рядка (зокрема текст агента з двома пробілами на початку лишається `text`);
  - `hooks/tasks.test.ts` — `syncAgents`: три кінцеві статуси, зникнення → `killed`, `idle`/`waiting` без змін, shell не зачіпається, без змін — той самий об'єкт;
  - `hooks/pane.test.tsx` — `agent.spawn` → вкладка й `TRANSCRIPT`; змоканий `session.messages` → у тілі видно `→ Read: …`; `agent.list` з `completed` + 10 с → вкладка зникає, панель закривається; `{ deny }` → `transcript unavailable`.
- `tsc -p .` без помилок; `claude plugin validate .` проходить.
- Смоук у живому Claude Code: запустити foreground `Explore` і фоновий агент поряд із фоновим `sleep 30; echo done`, пройти вкладки `ctrl+→` / `ctrl+←`, переконатися, що текст і тули оновлюються щосекунди, а ✓ агента зникає через 10 с.
