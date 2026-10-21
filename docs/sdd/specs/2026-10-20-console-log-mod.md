# console-log — панель виводу фонових задач — design

**Date:** 2026-10-20
**Status:** agreed
**Prototype:** docs/sdd/proto/console-log-pane/decision.md

## 1. Problem

Довгі команди Claude Code запускає у фоні (`run_in_background`, `ctrl+b`, автофон після тайм-ауту) або як `Monitor`. Їхній вивід пишеться у файл `tasks/<id>.output`. Людина цього виводу не бачить:
- `/tasks` показує лише назву, статус і кнопку зупинки;
- агент читає файл сам і часто обрізає вивід (`grep … | head -30`).

Так людина пропускає падіння тестів. Щоб побачити, що відбувається, треба окремим терміналом робити `tail -f` по шляху з `/tmp`.

Готового рішення немає. На GitHub є відкриті feature request про live tail у панелі `/tasks`.

## 2. Constraint that shapes the solution

Engine не дає моду ні потоку виводу фонової задачі, ні події про її завершення. Звідси три рішення:

- **Вивід.** Мод сам читає `tasks/<id>.output` командою `tail -n 200` раз на секунду. `$.fs.read` не підходить: він відмовляє на файлах понад 4 MiB. Потік `tail -F` через `$.process.spawn` відкинуто: він вимагає дочірній процес на кожну задачу й склеювання шматків тексту.
- **Статус.** Сповіщення про завершення (`<task-notification>`) приходить у `prompt.submit` з `origin.kind === 'task-notification'`. З його тексту беруться `<task-id>`, `<status>` і `exit code N`, причому N буває від'ємним. Це перевірено на Bash (completed / failed) і Monitor.
- **Клавіші.** Плагін не може постачати власні комбінації клавіш. `ctrl+→` / `ctrl+←` працюють лише з рядками в `~/.claude/keybindings.json` користувача.
- **Фокус.** Engine не дає API, яке повертає фокус промпту. Повернення реалізовано так: `$.ui.close` і одразу `$.ui.open` без `focus`.

## 3. Solution

### 3.1 Репозиторій і поставка

Корінь репозиторію `dmytro-rudenko/console-log` (публічний) — це сам плагін:

```
.claude-plugin/plugin.json        name "console-log", version "0.1.0", types "./types/index.d.ts"
.claude-plugin/marketplace.json   { name "console-log", owner { name "dmytro-rudenko" }, plugins [{ name "console-log", source "./" }] }
hooks/hooks.json                  { "modules": ["./register.tsx"] }
hooks/register.tsx                хуки й малювання
hooks/notification.ts             parseTaskNotification
hooks/sanitize.ts                 вирізання керуючих послідовностей
hooks/tasks.ts                    чисті переходи стану
hooks/*.test.ts(x)                тести claude plugin test
types/index.d.ts                  контракт $.state
README.md                         українська + англійська
```

Встановлення: `/plugin install console-log --marketplace dmytro-rudenko/console-log`.

### 3.2 Модулі

**`hooks/notification.ts`**
- Що робить: `parseTaskNotification(text: string): { id: string; status: string; exitCode?: number } | undefined`.
- Як працює: регулярні вирази `/<task-id>([^<]+)<\/task-id>/`, `/<status>([^<]+)<\/status>/`, `/exit code (-?\d+)/`. Без `id` або `status` повертає `undefined`.
- Залежності: жодних.

**`hooks/sanitize.ts`**
- Що робить: `sanitize(text: string): string`. Видаляє всі керуючі послідовності терміналу, а не лише CSI:
  - CSI `\x1b\[[0-?]*[ -/]*[@-~]`;
  - OSC `\x1b\][^\x07\x1b]*(\x07|\x1b\\)`;
  - DCS / SOS / PM / APC `\x1b[PX^_][^\x1b]*\x1b\\`;
  - решта двосимвольних `\x1b[@-_]`;
  - 8-бітні C1 `[\x80-\x9f]`;
  - потім усі C0 і DEL, окрім `\t` (`[\x00-\x08\x0a-\x1f\x7f]`, бо рядки вже розбито за `\n`).
- Як застосовується: до кожного рядка лога, а також до `command` і `label` перед тим, як їх зберегти в стан. Інакше OSC 8, OSC 52 (буфер обміну) чи зміна заголовка вікна з виводу або з опису задачі потрапили б у термінал користувача.
- Залежності: жодних.

**`hooks/tasks.ts`**
- Що робить: чисті функції над `{ tasks, selected }`, без `$`:
  - `addTask`: додає задачу в кінець, тримає не більше 20 і вибирає нову;
  - `applyNotification`: виставляє `status` і `exitCode`; `viewed` не чіпає — переглянутою задачу робить лише вибір користувача (`selectTask`);
  - `expireTasks(board, now, graceMs)`: Monitor без `status` після `deadline + 5000` → `status: 'expired'`;
  - `selectTask(i)`: якщо ціль — завершена задача не-`completed`, позначає її `viewed`. Якщо попередня вибрана задача мала `viewed`, видаляє її;
  - `dropTask(id)`: зберігає вибір за `id`, а якщо вибрану видалено, бере сусідню.
- Залежності: тип `ConsoleTask`.

**`hooks/register.tsx`**
- Що робить: з'єднує engine зі станом. Хуки:
  - `session.start`:
    - реєструє `/console-log`;
    - очищає `$.ui.status`;
    - видаляє задачі зі `status === 'completed'`;
    - перезапускає таймер, якщо є задачі без `status`;
    - читає `~/.claude/keybindings.json` (`$.env.get('HOME')`, `$.fs.read`) і виставляє `hasCtrlArrows`, якщо в контексті `Chat` є `"ctrl+right": "abovePrompt:focus"`.
  - `tool.call` (усі інструменти, у кінці завжди `next(e)`). Для `Bash` береться `result.backgroundTaskId`, для `Monitor` — `result.taskId`. Без id задача не реєструється.
    - Шлях до файлу — `result.backgroundOutputPath`, а якщо його немає, перший результат `ls -t ${TMPDIR:-/tmp}/claude-$(id -u)/*/<session id>/tasks/<id>.output` (`<session id>` з `$.session.id`). Якщо там порожньо, мод шукає ширше: `…/*/*/tasks/<id>.output`. Шлях не знайдено — задача все одно додається з `path: undefined`.
    - Підпис: `e.description` (у Monitor — `monitor: <description>`), а без нього — `command`.
    - Відкриває панель, якщо не `dismissed`, і запускає таймер.
  - `prompt.submit` з `origin.kind === 'task-notification'`: викликає `applyNotification` і ще раз перечитує файл. Для `completed` планує `$.clock.after(10000, dropTask)`.
  - `ui.focus` на панелі:
    - ціль `tab-<id>`: вибрати цю задачу;
    - ціль `exit` з останньої вкладки: `{}`, бо це перехід по колу;
    - ціль `exit` з інших вкладок: повернути фокус промпту (`close` + `open` без `focus`).
  - `ui.scroll` на панелі: повертає `{}`, без прокрутки.
  - `ui.close` з `origin.kind === 'person'`: `dismissed = true`.
  - `command.run` `console-log`: `dismissed = false` і `$.ui.open`.
  - `ui.render` `Pane`: малювання, див. 3.4.
- Таймер `$.clock.every(1000)`:
  - виконує `tail -n 200 <path>` для вибраної задачі (`timeoutMs: 2000`);
  - пропускає такт, якщо попередній `tail` ще не відповів;
  - пропускає кожен рядок через `sanitize` і лише потім обрізає до 500 символів;
  - зупиняється, коли не лишилось задач без `status`.
- Залежності: `notification.ts`, `sanitize.ts`, `tasks.ts`, `$.process`, `$.clock`, `$.ui`, `$.fs`, `$.env`.

**`types/index.d.ts`** — `PluginState['console-log']`:
- `tasks: ConsoleTask[]`, де `ConsoleTask = { id; kind: 'shell'|'monitor'; command; label?; path?; startedAt; status?; exitCode?; viewed? }`;
- `selected: number`;
- `lines: string[]`;
- `pathMissing: boolean`;
- `dismissed: boolean`;
- `hasCtrlArrows: boolean`.

### 3.3 Життєвий цикл задачі

| Подія | Результат |
|---|---|
| нова фонова задача | вкладка в кінці, стає вибраною, панель відкривається (якщо не `dismissed`) |
| `completed` | `✓`, через 10 с вкладка зникає |
| успішний `TaskStop` (сповіщення не надходить) | `status: 'killed'`, `■`, через 10 с вкладка зникає |
| `failed` / `killed` / інше | `✗` / `■`, вкладка лишається, доки користувач сам не перейшов на неї, а потім з неї (на іншу вкладку або в промпт) |
| Monitor пережив свій `timeout_ms` + 5 с без `<status>` | `status: 'expired'`, `■`, опитування зупиняється |
| задач не лишилось | `$.ui.close`, `dismissed` не змінюється |
| сповіщення для невідомого id | ігнорується |
| сповіщення не розібралось | задача лишається running, опитування триває до кінця сесії (окрім Monitor — див. expired) |
| панель закрита хрестиком | `tail` не запускається, доки не викликано `/console-log` |

### 3.4 Панель

- `$.ui.open({ id: 'console-log', title: 'Background output', columns: 100 })`.
- Розміри беруться з `W = e.props.bodyColumns` і `R = e.props.scroll.bodyRows`, а не з `e.viewport`.
- Корінь — `Box` з `width={W}`, `height={R}`, `backgroundColor="black"`.
- Рамки малюються вручну одним `Text` на рядок точної ширини `W`:
  - верх: `╭─ TITLE ───── right ─╮`;
  - бік: `│ … │`;
  - низ: `╰─ hint ─────╯`.
  - Колір рамок `gray`, заголовків `cyan` жирним, підписів dim.
- Розташування рядків: `BACKGROUND` (3 рядки: верх, вкладки, низ із підказкою) і `OUTPUT` (`R − 3` рядки: верх, `R − 5` рядків лога, низ із командою).
  - Справа у верхній рамці `BACKGROUND` — `N task(s)`, у рамці `OUTPUT` — статус: `running`, `completed · exit 0`, `failed · exit 1`.
  - Лог показує останні `R − 5` рядків і доповнюється порожніми до низу.
- Вкладки — `Button plain` з `key="tab-<id>"`:
  - вміст: позначка, підпис до 22 символів, вік (`12s`, `1m05s`);
  - вибрана вкладка: `cyan` жирна з підкресленням, решта dim;
  - позначки: `◐` yellow (running), `✓` green, `✗` red, `■` gray;
  - якщо вкладки не вміщуються, мод показує вікно навколо вибраної з маркерами `‹N` і `N›`;
  - `onPress` нічого не робить, `hotkey` немає.
- Перед вкладками стоїть невидима `Button plain label=" " key="exit"`. `autoFocus` має перша вкладка (`tab-<id>` задачі з індексом 0), а не `exit`.
- Підказка в нижній рамці `BACKGROUND`:
  - у фокусі: `ctrl+→ next · ctrl+← back`;
  - без фокусу: `ctrl+→ focus`, а якщо `!hasCtrlArrows` — `ctrl+x tab focus`.
- Порожні стани:
  - `No background tasks yet.`;
  - тіло `OUTPUT`: `output file not found` при `path: undefined`, а при збої `tail` в рамці додається `· file unavailable`.

### 3.5 Керування

Лише `ctrl+→` / `ctrl+←`, задані в `~/.claude/keybindings.json`. README містить готовий фрагмент:

```json
{ "context": "Chat",        "bindings": { "ctrl+right": "abovePrompt:focus" } },
{ "context": "AbovePrompt", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } },
{ "context": "Pane",        "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } }
```

Без цього фрагмента працюють стандартні клавіші engine: `ctrl+x tab`, `←`/`→` і `esc`. Мод їх не вимикає.

## 4. Out of scope

- Пошук, фільтрація й прокрутка лога.
- Збереження ANSI-кольорів і підсвітка помилок.
- Вивід субагентів і workflow.
- Задачі, запущені до завантаження мода.
- Історія між сесіями.
- Автоматичний запис у `keybindings.json`.
- Робота на surface `desktop` / `vscode` / `mobile`: перевіряється лише `terminal`.

## 5. Trade-offs accepted

- Затримка оновлення до 1 с і запуск одного `tail` на секунду, поки є running-задача.
- `ctrl+→` у полі вводу більше не перескакує на наступне слово, для цього лишається `alt+→`. Але це стосується лише тих, хто вставив фрагмент із README.
- Під час повернення в промпт панель на мить закривається й відкривається знову.
- Звичайні `←`/`→`, Tab і клік теж перемикають вкладки, бо це стандарт engine для всіх панелей.
- Рамку пристикованої панелі (сірі рядки згори з `✕` і знизу) малює engine, і чорне тло її не покриває.
- Підпис ✗-задачі, яку ніхто не відкрив, висить до кінця сесії.

## 6. Verification

- `claude plugin validate .` без помилок.
- `tsc -p .` без помилок.
- `claude plugin test .`:
  - `sanitize.test.ts`: CSI-колір, OSC 8-посилання з BEL і з ST, OSC 52, DCS, 8-бітний CSI `\x9b`, `\r`, `\x07` зникають; `\t` і юнікод (`✓`, кирилиця) лишаються;
  - `notification.test.ts`: зразки з цієї сесії — `completed (exit code 0)`, `failed with exit code 1`, `failed with exit code 3`, `completed (exit code -1)`, Monitor `stream ended` без коду, текст, що не є сповіщенням;
  - `tasks.test.ts`: ліміт 20; `applyNotification` з `viewed` для вибраної й невибраної; `selectTask` видаляє переглянуту ✗ при переході; `dropTask` зберігає вибір за id;
  - `pane.test.tsx` (surface `terminal`, `bodyColumns: 100`, `bodyRows: 30`): кожен рядок рамок рівно `W` символів; заголовки `BACKGROUND` / `OUTPUT`; позначки для кожного статусу; лог доповнено до `R − 5`; підказка при `isFocused` і при `hasCtrlArrows: false`.
- Ручний smoke-тест у сесії зі встановленим із GitHub плагіном і фрагментом keybindings:
  1. Три фонові Bash-задачі одночасно: панель відкривається, вкладки з'являються, лог оновлюється щосекунди.
  2. `ctrl+→` з промпту відкриває першу задачу, `ctrl+→` веде до наступної й зупиняється на останній, `ctrl+←` на першій повертає в промпт.
  3. ✓ зникає за 10 с. ✗ лишається, а після перегляду й переходу зникає. Без задач панель закривається.
  4. `Monitor` з'являється як вкладка `monitor: …`.
  5. Закрита хрестиком панель не відкривається сама, доки не викликано `/console-log`.
