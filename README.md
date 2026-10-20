# console-log

A Claude Code mod that adds a pane beside the chat. The pane shows the last 200 lines of each background Bash or Monitor task, such as `pnpm test` or `vite`, and refreshes every second.

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
- `ctrl+→` moves to the next task. On the last task it does nothing.
- `ctrl+←` moves to the previous task. On the first task it returns to the prompt.

Without the snippet, the standard Claude Code keys still work: `ctrl+x tab`, `←`/`→` and `esc`.

Trade-off: once you add the snippet, `ctrl+→` in the prompt no longer jumps to the next word. Use `alt+→` for that.

## Behaviour

- `◐` marks a running task.
- `✓` marks a completed task. It disappears after 10 seconds.
- `✗` (failed) and `■` (other end states) stay until you open the task and then move to another tab or back to the prompt.
- When no tasks are left, the pane closes.
- If you close the pane with its `✕`, it stays closed until you run `/console-log`.
- The pane sits beside the chat when the terminal is at least 110 columns wide.

## Limits

- Only background tasks started after the mod loaded are shown.
- ANSI colours are stripped from the output.
- The pane frame (the grey lines and the `✕`) is drawn by Claude Code, not by the mod.

## Українською

Мод для Claude Code, який додає панель поруч із чатом. Панель показує останні 200 рядків кожної фонової задачі Bash або Monitor, наприклад `pnpm test` чи `vite`, і оновлюється щосекунди.

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
- `ctrl+→` переходить до наступної задачі. На останній нічого не робить.
- `ctrl+←` переходить до попередньої задачі. З першої повертає в промпт.

Без фрагмента працюють стандартні клавіші Claude Code: `ctrl+x tab`, `←`/`→` і `esc`.

Компроміс: після додавання фрагмента `ctrl+→` у промпті більше не перескакує на наступне слово. Для цього лишається `alt+→`.

### Поведінка

- `◐` позначає задачу, що виконується.
- `✓` позначає завершену задачу. Вона зникає через 10 секунд.
- `✗` (помилка) і `■` (інші кінцеві стани) лишаються, доки ви не відкриєте задачу й не перейдете на іншу вкладку або назад у промпт.
- Коли задач не лишилося, панель закривається.
- Якщо закрити панель її `✕`, вона лишається закритою до команди `/console-log`.
- Панель стоїть збоку від чату, коли термінал має щонайменше 110 колонок.

### Обмеження

- Показуються лише фонові задачі, запущені після завантаження мода.
- ANSI-кольори з виводу вирізаються.
- Рамку панелі (сірі рядки та `✕`) малює Claude Code, а не мод.

## License

MIT. See [LICENSE](LICENSE).
