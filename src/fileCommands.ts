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

export function registerFileCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
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

    // Register the 'Tex Normalization' command
    const texNormalizationCommand = vscode.commands.registerCommand('lutex-ext.texNormalization', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            outputChannel.appendLine('[Tex Normalization] No active editor found');
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const document = editor.document;
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const fullText = document.getText();

        // Replace all occurrences of {text> with {text}
        const normalizedText = fullText.replace(/\{([a-zA-Z]+)>/g, '{$1}');
        
        // Count the number of replacements made
        const matches = fullText.match(/\{([a-zA-Z]+)>/g);
        const replacementCount = matches ? matches.length : 0;

        if (replacementCount > 0) {
            // Apply the changes to the document
            editor.edit(editBuilder => {
                editBuilder.replace(fullRange, normalizedText);
            });

            outputChannel.appendLine(`[Tex Normalization] Replaced ${replacementCount} occurrence(s) of {text> with {text}`);
            vscode.window.showInformationMessage(`Tex Normalization: ${replacementCount} replacement(s) made`);
        } else {
            outputChannel.appendLine(`[Tex Normalization] No {text> patterns found to replace`);
            vscode.window.showInformationMessage('Tex Normalization: No patterns found to replace');
        }
    });

    // Add the commands to the context subscriptions
    context.subscriptions.push(inlineToDisplayCommand);
    context.subscriptions.push(texNormalizationCommand);
}

// Export the patterns for potential use elsewhere
export { TransformPattern, transformPatterns };