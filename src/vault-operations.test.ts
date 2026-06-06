import { describe, expect, it, vi } from 'vitest';
import {
	replaceVaultFileContent,
	trashVaultFile,
} from './vault-operations';

describe('vault operations', () => {
	it('replaces background file content through Vault.process', async () => {
		const file = { path: 'Home.md' };
		const process = vi.fn(async (
			receivedFile: typeof file,
			callback: (content: string) => string,
		) => {
			expect(receivedFile).toBe(file);
			return callback('old content');
		});

		await replaceVaultFileContent({ process }, file, 'new content');

		expect(process).toHaveBeenCalledOnce();
		expect(await process.mock.results[0]?.value).toBe('new content');
	});

	it('moves files to trash through FileManager.trashFile', async () => {
		const file = { path: '2026-06-06.md' };
		const trashFile = vi.fn(async () => undefined);

		await trashVaultFile({ trashFile }, file);

		expect(trashFile).toHaveBeenCalledOnce();
		expect(trashFile).toHaveBeenCalledWith(file);
	});
});
