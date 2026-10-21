# console-log

A Claude Code mod that adds a pane beside the chat. For each background Bash or Monitor task, such as `pnpm test` or `vite`, the pane shows the latest lines that fit, from the last 200 of its output, and refreshes every second. It does not scroll.

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

## Keys

A plugin cannot ship key bindings, so you add them yourself. Merge this into `~/.claude/keybindings.json`. If the file already has a `bindings` array, add these three entries to it.

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+right": "abovePrompt:focus" } },
    { "context": "AbovePrompt", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } },
    { "context": "Pane", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } }
  ]
}
```

With these bindings:

- `ctrl+→` in the prompt moves focus to the first task.
- `ctrl+→` moves to the next task. On the last task it does nothing; with a single task it returns to the prompt.
- `ctrl+←` moves to the previous task. On the first task it returns to the prompt.

Without the snippet, the standard Claude Code keys still work: `ctrl+x tab`, `←`/`→` and `esc`.

Trade-off: once you add the snippet, `ctrl+→` in the prompt no longer jumps to the next word. Use `alt+→` for that.

## Behaviour

- `◐` marks a running task.
- `✓` marks a completed task. It disappears after 10 seconds.
- `✗` (failed) and `■` (other end states) stay until you have moved onto the tab and then away from it, to another tab or back to the prompt.
- A Monitor that runs past its timeout shows `■` and `expired`.
- When no tasks are left, the pane closes.
- If you close the pane with its `✕`, it stays closed until you run `/console-log`.
- In the fullscreen layout, a pane the mod opens on its own docks beside the chat from 144 terminal columns. Below that, run `/console-log` once; after that the pane docks from 110 columns.

## Limits

- Only background tasks started after the mod loaded are shown.
- ANSI colours are stripped from the output.
- The pane frame (the grey lines and the `✕`) is drawn by Claude Code, not by the mod.

## Development

In a fresh clone, `tsconfig.json` extends types that Claude Code writes into `.claude-plugin/types` the first time it loads the mod. Load the mod once before type-checking.

## Українською

Мод для Claude Code, який додає панель поруч із чатом. Для кожної фонової задачі Bash або Monitor, наприклад `pnpm test` чи `vite`, панель показує найновіші рядки, що вміщаються, з останніх 200 рядків виводу, і оновлюється щосекунди. Прокрутки немає.

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

### Клавіші

Плагін не може постачати власні клавіші, тож їх треба додати вручну. Злийте цей фрагмент із `~/.claude/keybindings.json`. Якщо у файлі вже є масив `bindings`, додайте до нього ці три записи.

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+right": "abovePrompt:focus" } },
    { "context": "AbovePrompt", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } },
    { "context": "Pane", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } }
  ]
}
```

З цими клавішами:

- `ctrl+→` у промпті переводить фокус на першу задачу.
- `ctrl+→` переходить до наступної задачі. На останній нічого не робить; якщо задача одна, повертає в промпт.
- `ctrl+←` переходить до попередньої задачі. З першої повертає в промпт.

Без фрагмента працюють стандартні клавіші Claude Code: `ctrl+x tab`, `←`/`→` і `esc`.

Компроміс: після додавання фрагмента `ctrl+→` у промпті більше не перескакує на наступне слово. Для цього лишається `alt+→`.

### Поведінка

- `◐` позначає задачу, що виконується.
- `✓` позначає завершену задачу. Вона зникає через 10 секунд.
- `✗` (помилка) і `■` (інші кінцеві стани) лишаються, доки ви не перейдете на цю вкладку, а потім з неї: на іншу вкладку або назад у промпт.
- Monitor, що працював довше за свій тайм-аут, показує `■` і `expired`.
- Коли задач не лишилося, панель закривається.
- Якщо закрити панель її `✕`, вона лишається закритою до команди `/console-log`.
- У повноекранному режимі панель, яку мод відкриває сам, стає збоку від чату від 144 колонок термінала. Якщо колонок менше, один раз виконайте `/console-log`; після цього панель стає збоку від 110 колонок.

### Обмеження

- Показуються лише фонові задачі, запущені після завантаження мода.
- ANSI-кольори з виводу вирізаються.
- Рамку панелі (сірі рядки та `✕`) малює Claude Code, а не мод.

### Розробка

У свіжому клоні `tsconfig.json` розширює типи, які Claude Code записує в `.claude-plugin/types` під час першого завантаження мода. Завантажте мод один раз перед перевіркою типів.

## License

MIT. See [LICENSE](LICENSE).
