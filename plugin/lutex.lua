if vim.g.loaded_lutex then
  return
end
vim.g.loaded_lutex = true

vim.api.nvim_create_user_command('LutexListen', function()
  require('lutex').start()
end, { desc = 'Start the LuTeX jump listener bound to this nvim' })

vim.api.nvim_create_user_command('LutexStop', function()
  require('lutex').stop()
end, { desc = 'Stop the LuTeX jump listener' })

vim.api.nvim_create_user_command('LutexScroll', function()
  require('lutex').scroll()
end, { desc = 'Scroll the LuTeX browser preview to the cursor line' })

vim.api.nvim_create_user_command('LutexMd', function()
  require('lutex').open('md')
end, { desc = 'Preview the current file as a Markdown notebook (starts the listener if needed)' })

vim.api.nvim_create_user_command('LutexSlides', function()
  require('lutex').open('slides')
end, { desc = 'Preview the current file as slides (starts the listener if needed)' })

vim.api.nvim_create_user_command('LutexTex', function()
  require('lutex').open('tex')
end, { desc = 'Preview the current file as LaTeX (starts the listener if needed)' })

vim.api.nvim_create_user_command('LutexInlineToDisplay', function()
  require('lutex').inline_to_display()
end, { range = true, desc = 'Convert the selected inline math to a display equation block' })
