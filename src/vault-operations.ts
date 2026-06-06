export interface VaultProcessor<TFile> {
	process(file: TFile, callback: (content: string) => string): Promise<string>;
}

export interface FileTrasher<TFile> {
	trashFile(file: TFile): Promise<void>;
}

export async function replaceVaultFileContent<TFile>(
	vault: VaultProcessor<TFile>,
	file: TFile,
	content: string,
): Promise<void> {
	await vault.process(file, () => content);
}

export async function trashVaultFile<TFile>(
	fileManager: FileTrasher<TFile>,
	file: TFile,
): Promise<void> {
	await fileManager.trashFile(file);
}
