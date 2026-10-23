# console-log

A Claude Code mod that adds a pane beside the chat. It shows one task at a time, the newest one still running. For a background Bash or Monitor task, such as `pnpm test` or `vite`, that is the latest lines that fit from the last 200 of its output, refreshed every second. Subagents show there too, with their transcripts. It does not scroll.

## Requirements

- The Claude Code terminal surface.
- A POSIX `sh`, `tail`, `ls` and `id` on the machine. Native Windows is not supported.

## Install

From the Claude Code prompt:

```
/plugin install console-log --marketplace dmytro-rudenko/console-log
```

Answer `y`, then choose a scope.

From a shell:

```
claude plugin install console-log --marketplace dmytro-rudenko/console-log
```

## Behaviour

- The pane shows one task at a time and follows the newest one that is still running, a background Bash or Monitor task or a subagent. When it ends, the pane moves to the next newest running task.
- Open a subagent in the task list under the prompt (the standard Claude Code list) and the pane shows that subagent, marked `in view`, until you go back to `main`. Claude Code also switches the main view to that subagent; a mod cannot keep the main view on the conversation.
- A subagent's body, framed `TRANSCRIPT`, shows the first line of its prompt (`▸`), its text, each tool call as `→ Tool: argument`, and up to three lines of each tool result (`… +N lines` for the rest, `✗` on an error, `…` while the tool runs). A shell or Monitor task is framed `OUTPUT`.
- The top line shows the task's status and how many tasks are running; the next line shows `◐` running, `✓` completed, `✗` failed or `■` another end state, then the task's label and age.
- A command you run with `!` and then send to the background shows there too.
- A Monitor that runs past its timeout shows `■` and `expired`. A subagent the session no longer lists shows `■` and `killed`.
- A finished task leaves 10 seconds after it ends; while nothing else is running, the pane keeps showing the last one until then. When no tasks are left, the pane closes.
- If you close the pane with its `✕`, it stays closed until you run `/console-log`.
- In the fullscreen layout, a pane the mod opens on its own docks beside the chat from 144 terminal columns. Below that, run `/console-log` once; after that the pane docks from 110 columns.

## Limits

- Only background Bash and Monitor tasks started after the mod loaded are shown. Subagents already running when the mod loads, or when you run `/console-log`, show too.
- ANSI colours are stripped from the output.
- The pane frame (the grey lines and the `✕`) is drawn by Claude Code, not by the mod.
- A tool result in a subagent's transcript shows at most three lines.
- Workflow agents and teammates show only when you open them in the task list.
- Picking a background process in the task list opens Claude Code's own dialog; the pane does not follow it.
- While the pane is closed it does not see what you open in the task list; `/console-log` opens it on the agent in view.

## Development

In a fresh clone, `tsconfig.json` extends types that Claude Code writes into `.claude-plugin/types` the first time it loads the mod. Load the mod once before type-checking.

## Українською

Мод для Claude Code, який додає панель поруч із чатом. Вона показує одну задачу за раз — найновішу з тих, що працюють. Для фонової задачі Bash або Monitor, наприклад `pnpm test` чи `vite`, це найновіші рядки, що вміщаються, з останніх 200 рядків виводу, з оновленням щосекунди. Субагенти теж показуються там, зі своїми транскриптами. Прокрутки немає.

### Вимоги

- Термінальна поверхня Claude Code.
- POSIX `sh`, `tail`, `ls` і `id` на машині. Нативний Windows не підтримується.

### Встановлення

З промпту Claude Code:

```
/plugin install console-log --marketplace dmytro-rudenko/console-log
```

Відповідайте `y` і виберіть scope.

З shell:

```
claude plugin install console-log --marketplace dmytro-rudenko/console-log
```

### Поведінка

- Панель показує одну задачу й іде за найновішою, що ще працює: фоновою Bash чи Monitor або субагентом. Коли вона завершується, панель переходить до наступної найновішої.
- Відкрийте субагента в списку задач під промптом (стандартний список Claude Code), і панель показує його з позначкою `in view`, поки ви не повернетесь на `main`. Основне вікно Claude Code теж перемикає на цього субагента; мод не може втримати його на розмові.
- Тіло субагента в рамці `TRANSCRIPT` показує перший рядок промпту (`▸`), його текст, кожен виклик тула як `→ Tool: аргумент` і до трьох рядків результату (`… +N lines` для решти, `✗` на помилці, `…`, поки тул працює). Shell чи Monitor — у рамці `OUTPUT`.
- Верхній рядок показує статус задачі й скільки задач працює; наступний — `◐` працює, `✓` завершено, `✗` помилка, `■` інший кінець, далі назву й вік задачі.
- Команда, яку ви запустили через `!` і відправили у фон, теж показується.
- Monitor, що пережив свій timeout, показує `■` і `expired`. Субагент, якого сесія більше не має у списку, показує `■` і `killed`.
- Завершена задача зникає через 10 секунд після кінця; поки нічого іншого не працює, панель до того часу показує останню. Коли задач не лишилось, панель закривається.
- Якщо закрити панель її `✕`, вона лишається закритою до `/console-log`.
- У fullscreen-розкладці панель, яку мод відкриває сам, стає поруч із чатом від 144 колонок терміналу. Вужче — один раз виконайте `/console-log`, після цього панель стає поруч від 110 колонок.

### Обмеження

- Показуються лише фонові задачі Bash і Monitor, запущені після завантаження мода. Субагенти, що вже працюють, коли мод завантажується або коли ви виконуєте `/console-log`, теж показуються.
- ANSI-кольори з виводу вирізаються.
- Рамку панелі (сірі рядки та `✕`) малює Claude Code, а не мод.
- Результат тулу в транскрипті субагента показує щонайбільше три рядки.
- Агенти воркфлоу й teammates показуються, лише коли ви відкриваєте їх у списку задач.
- Вибір фонового процесу в списку задач відкриває власний діалог Claude Code; панель за ним не йде.
- Поки панель закрита, вона не бачить, що ви відкриваєте в списку задач; `/console-log` відкриває її на агенті, який зараз відкритий.

### Розробка

У свіжому клоні `tsconfig.json` розширює типи, які Claude Code записує в `.claude-plugin/types` під час першого завантаження мода. Завантажте мод один раз перед перевіркою типів.

## License

MIT. See [LICENSE](LICENSE).
