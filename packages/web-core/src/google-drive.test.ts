import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { driveDownload, driveFolderIdFrom, driveListFolder, parseServiceAccount, serviceAccountToken } from './google-drive';
import { startMockWeb, type MockWebState } from './mock-web';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const saJson = JSON.stringify({ type: 'service_account', client_email: 'importer@proj.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'http://evil.example/token' });

let mock: { url: string; state: MockWebState; server: import('node:http').Server };
beforeAll(async () => { mock = await startMockWeb(); });
afterAll(() => { mock.server.close(); });

describe('google drive (service account)', () => {
  it('ตรวจไฟล์คีย์และรหัสโฟลเดอร์', () => {
    expect(parseServiceAccount(saJson).client_email).toBe('importer@proj.iam.gserviceaccount.com');
    expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow('service account');
    expect(() => parseServiceAccount('nope')).toThrow('JSON');
    expect(driveFolderIdFrom('https://drive.google.com/drive/folders/1AbC_def-GHIjkl?usp=sharing')).toBe('1AbC_def-GHIjkl');
    expect(driveFolderIdFrom('FOLDER_OK_1234')).toBe('FOLDER_OK_1234');
    expect(driveFolderIdFrom("x' or '1'='1")).toBeNull();
  });

  it('JWT → token → รายการไฟล์ → ดาวน์โหลด (ไม่ใช้ token_uri จากไฟล์คีย์)', async () => {
    const base = `${mock.url}/google`;
    mock.state.drive.files = [
      { id: 'f1', name: 'posts.json', mimeType: 'application/json', md5Checksum: 'aa', modifiedTime: '2026-09-27T01:00:00Z', content: Buffer.from('{"posts":[]}') },
      { id: 'd1', name: 'บทความ', mimeType: 'application/vnd.google-apps.document', md5Checksum: '', modifiedTime: '2026-09-27T02:00:00Z', content: Buffer.from('{"caption":"x"}') },
    ];
    const token = await serviceAccountToken(parseServiceAccount(saJson), undefined, { baseUrl: base });
    expect(token).toBe('DRIVE_TOKEN');
    expect(mock.state.drive.tokenIssuers).toEqual(['importer@proj.iam.gserviceaccount.com']);
    const files = await driveListFolder(token, 'FOLDER_OK_1234', { baseUrl: base });
    expect(files.map(f => f.name)).toEqual(['บทความ', 'posts.json']);
    expect((await driveDownload(token, files[1]!, { baseUrl: base })).toString()).toBe('{"posts":[]}');
    expect((await driveDownload(token, files[0]!, { baseUrl: base })).toString()).toBe('{"caption":"x"}');
    await expect(driveDownload(token, files[1]!, { baseUrl: base, maxBytes: 3 })).rejects.toThrow('ใหญ่เกิน');
    await expect(driveListFolder(token, 'OTHER_FOLDER_99', { baseUrl: base })).rejects.toThrow('แชร์โฟลเดอร์');
  });
});
