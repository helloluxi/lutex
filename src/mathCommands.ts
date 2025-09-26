import * as vscode from 'vscode';

// Transformation patterns for flexible pre/suffix handling
interface TransformPattern {
    prefix: string;
    suffix: string;
    description: string;
    targetFormat: (content: string) => string;
}

// Define transformation patterns - easily extensible
const transformPatterns: TransformPattern[] = [
    {
        prefix: '$',
        suffix: '$',
        description: 'inline math ($...$)',
        targetFormat: (content: string) => [
            '',
            '\\begin{equation}',
            '\\begin{aligned}',
            content,
            '\\end{aligned}',
            '\\end{equation}',
            ''
        ].join('\n')
    },
    {
        prefix: '\\begin{equation}',
        suffix: '\\end{equation}',
        description: 'equation block',
        targetFormat: (content: string) => [
            '',
            '\\begin{equation}',
            '\\begin{aligned}',
            content.trim(),
            '\\end{aligned}',
            '\\end{equation}',
            ''
        ].join('\n')
    }
];

export function registerMathCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
    // Register the 'Inline to display' command
    const inlineToDisplayCommand = vscode.commands.registerCommand('lutex-ext.inlineToDisplay', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            outputChannel.appendLine('[Inline to Display] No active editor found');
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        // Try to match against all transformation patterns
        for (const pattern of transformPatterns) {
            if (selectedText.startsWith(pattern.prefix) && 
                selectedText.endsWith(pattern.suffix) && 
                selectedText.length > pattern.prefix.length + pattern.suffix.length) {
                
                // Extract the content between the prefix and suffix
                const content = selectedText.slice(
                    pattern.prefix.length, 
                    selectedText.length - pattern.suffix.length
                );
                
                // Apply the transformation
                const transformedText = pattern.targetFormat(content);

                // Replace the selected text
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, transformedText);
                });

                outputChannel.appendLine(`[Inline to Display] Converted ${pattern.description} to display format: ${content.trim()}`);
                return;
            }
        }

        // If no pattern matched, show warning with supported formats
        const supportedFormats = transformPatterns.map(p => `${p.prefix}...${p.suffix}`).join(', ');
        outputChannel.appendLine(`[Inline to Display] No matching pattern found for selected text`);
        vscode.window.showErrorMessage(`Please select text with one of these formats: ${supportedFormats}`);
    });

    // Add the command to the context subscriptions
    context.subscriptions.push(inlineToDisplayCommand);
}

// Export the patterns for potential use elsewhere
export { TransformPattern, transformPatterns };