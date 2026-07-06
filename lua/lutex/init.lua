-- lutex.nvim — thin shim that spawns the standalone listener bound to this nvim.
-- The listener itself is Node (out/cli.js); this file only starts/stops it and
-- surfaces the bound port. It never edits ~/.config/nvim.

local M = {}

local state = {
  job = nil,
  port = nil,
  opts = { port = 12023, autostart = false },
}

-- Absolute path of the plugin root, derived from this file: <root>/lua/lutex/init.lua
local function plugin_root()
  local src = debug.getinfo(1, 'S').source:sub(2)
  return vim.fn.fnamemodify(src, ':h:h:h')
end

local function cli_path()
  return plugin_root() .. '/out/cli.js'
end

function M.start()
  if state.job then
    vim.notify('[lutex] listener already running on port ' .. tostring(state.port), vim.log.levels.INFO)
    return
  end

  local cli = cli_path()
  if vim.fn.filereadable(cli) == 0 then
    vim.notify('[lutex] CLI not built: ' .. cli .. ' (run: pnpm install && pnpm run compile)', vim.log.levels.ERROR)
    return
  end

  local sock = vim.v.servername
  if sock == nil or sock == '' then
    sock = vim.fn.serverstart()
  end

  local cmd = { 'node', cli, 'listen', '--nvim', sock, '--port', tostring(state.opts.port) }
  state.job = vim.fn.jobstart(cmd, {
    on_stdout = function(_, data)
      for _, line in ipairs(data or {}) do
        local p = line:match('^LUTEX_LISTENING (%d+)')
        if p then
          state.port = tonumber(p)
          vim.g.lutex_port = state.port
          vim.notify('[lutex] listener started on port ' .. p, vim.log.levels.INFO)
        end
      end
    end,
    on_exit = function()
      state.job = nil
      state.port = nil
      vim.g.lutex_port = nil
    end,
  })

  if state.job <= 0 then
    state.job = nil
    vim.notify('[lutex] failed to start listener (is node on PATH?)', vim.log.levels.ERROR)
    return
  end

  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = vim.api.nvim_create_augroup('LutexShutdown', { clear = true }),
    callback = function() M.stop() end,
  })
end

function M.stop()
  if not state.job then
    return
  end
  vim.fn.jobstop(state.job)
  state.job = nil
  state.port = nil
  vim.g.lutex_port = nil
end

-- POST the current cursor (absolute file + line) to the listener's /scroll, which relays an SSE
-- scroll event to the browser preview. Fire-and-forget via curl.
function M.scroll()
  if not state.port then
    vim.notify('[lutex] listener not running (run :LutexListen)', vim.log.levels.WARN)
    return
  end
  local file = vim.api.nvim_buf_get_name(0)
  if file == '' then
    return
  end
  local line = vim.api.nvim_win_get_cursor(0)[1]
  local body = vim.json.encode({ file = file, line = line })
  vim.system({
    'curl', '-s', '-X', 'POST',
    'http://127.0.0.1:' .. state.port .. '/scroll',
    '-H', 'Content-Type: application/json',
    '-d', body,
  })
end

-- For statusline use (e.g. lualine): "lutex:<port>" when running, "" otherwise.
function M.status()
  if state.port then
    return 'lutex:' .. state.port
  end
  return ''
end

-- Open the browser preview for the current buffer in the given view ('md' | 'slides' | 'tex').
-- The CLI launcher (`lutex <kind>`) always targets the shared view daemon (auto-started if needed);
-- we pass --listener so the page can reach *this* nvim's jump/scroll listener via `?o=`, and --dump
-- for slides so editor-driven authoring keeps writing static dist/+index.html next to the file.
function M.open(kind)
  local file = vim.api.nvim_buf_get_name(0)
  if file == '' then
    vim.notify('[lutex] current buffer has no file', vim.log.levels.WARN)
    return
  end

  local function launch()
    local cmd = { 'node', cli_path(), kind, file, '--listener', tostring(state.port) }
    if kind == 'slides' then
      table.insert(cmd, '--dump')
    end
    vim.system(cmd, { text = true }, function(res)
      if res.code ~= 0 then
        vim.schedule(function()
          vim.notify('[lutex] open failed: ' .. vim.trim(res.stderr or ''), vim.log.levels.ERROR)
        end)
      end
    end)
  end

  if state.port then
    launch()
    return
  end

  M.start()
  vim.wait(3000, function() return state.port ~= nil end, 50)
  if not state.port then
    vim.notify('[lutex] listener did not start in time', vim.log.levels.ERROR)
    return
  end
  launch()
end

-- Wrap the most recent visual selection in a display-math block. Mirrors the VSCode
-- `lutex.inlineToDisplay` transform: `$…$` (with optional trailing ,;.) or a `\begin{equation}…`
-- block becomes an equation/aligned block. Pure buffer edit — no listener needed.
local function display_block(content)
  return table.concat({
    '',
    '\\begin{equation}',
    '\\begin{aligned}',
    '    ' .. content,
    '\\end{aligned}',
    '\\end{equation}',
    '',
  }, '\n')
end

local function transform_selection(sel)
  local inner, punct = sel:match('^%$(.+)%$([,;.]?)$')
  if inner then
    return display_block(inner .. (punct or ''))
  end
  local pre, suf = '\\begin{equation}', '\\end{equation}'
  if #sel > #pre + #suf and sel:sub(1, #pre) == pre and sel:sub(-#suf) == suf then
    return display_block(vim.trim(sel:sub(#pre + 1, #sel - #suf)))
  end
  return nil
end

function M.inline_to_display()
  local sp = vim.fn.getpos("'<")
  local ep = vim.fn.getpos("'>")
  local sl, sc, el, ec = sp[2], sp[3], ep[2], ep[3]
  if sl == 0 or el == 0 then
    vim.notify('[lutex] no visual selection found', vim.log.levels.WARN)
    return
  end
  local last = vim.api.nvim_buf_get_lines(0, el - 1, el, false)[1] or ''
  ec = math.min(ec, #last) -- '> col is v:maxcol for linewise; clamp to the line length
  local sel = table.concat(vim.api.nvim_buf_get_text(0, sl - 1, sc - 1, el - 1, ec, {}), '\n')

  local replacement = transform_selection(sel)
  if not replacement then
    vim.notify('[lutex] selection is not $…$ or a \\begin{equation} block', vim.log.levels.WARN)
    return
  end
  vim.api.nvim_buf_set_text(0, sl - 1, sc - 1, el - 1, ec, vim.split(replacement, '\n'))
end

local function project_autostart()
  local root = vim.fs.root(0, '.lutex.json')
  if not root then
    return false
  end
  local ok, data = pcall(function()
    return vim.json.decode(table.concat(vim.fn.readfile(root .. '/.lutex.json'), '\n'))
  end)
  return ok and type(data) == 'table' and data.autostart == true
end

function M.setup(opts)
  state.opts = vim.tbl_extend('force', state.opts, opts or {})
  local a = state.opts.autostart
  if a == true or (a == 'project' and project_autostart()) then
    M.start()
  end
end

return M
