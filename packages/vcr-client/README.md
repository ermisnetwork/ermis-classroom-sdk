# VCR Integration SDK (API Key) – `@ermisnetwork/vcr-client`

**Version:** 1.0.0  
**Last Updated:** 2026-01-27

TypeScript SDK cho VCR API dùng **API Key** (header `x-api-key`). Hỗ trợ quản lý **Events**, **Registrants** (kèm moderation), **Rewards**, **Ratings** (read-only), và **Documents**.

---

## 📦 Cài đặt

```bash
npm install @ermisnetwork/vcr-client
# hoặc
pnpm add @ermisnetwork/vcr-client
# hoặc
yarn add @ermisnetwork/vcr-client
```

---

## 🚀 Quick Start

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

// Khởi tạo client
const client = createVCRClient({
  apiKey: process.env.VCR_API_KEY!,
  baseUrl: 'https://api.vcr.example.com',
});

// Tạo event
const event = await client.events.create({
  title: 'Math 101',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T10:00:00Z',
});

// Thêm học viên
const registrant = await client.registrants.create(event._id, {
  authId: 'user_123',
  firstName: 'John',
  lastName: 'Doe',
  role: 'student',
});

// Upload tài liệu
const document = await client.documents.upload(event._id, {
  file: fileObject,
  title: 'Lecture Notes',
});
```

---

## ⚙️ Cấu hình (Configuration)

```typescript
interface VCRClientConfig {
  apiKey: string;              // API Key (bắt buộc)
  baseUrl?: string;            // Base URL (default: https://api.vcr.example.com)
  timeout?: number;            // Request timeout ms (default: 30000)
  headers?: Record<string, string>;  // Custom headers
  useAuthorizationHeader?: boolean;  // Dùng Authorization: Bearer thay vì x-api-key (default: false)
  language?: 'vi' | 'en';      // Ngôn ngữ response (default: 'vi')
}
```

### Ví dụ khởi tạo

```typescript
import { createVCRClient, VCRClient } from '@ermisnetwork/vcr-client';

// Cách 1: Factory function
const client = createVCRClient({
  apiKey: process.env.VCR_API_KEY!,
  baseUrl: 'https://api.vcr.example.com',
  language: 'vi',
  timeout: 60000, // 60 giây cho file lớn
});

// Cách 2: Class constructor
const client2 = new VCRClient({
  apiKey: process.env.VCR_API_KEY!,
});

// Đổi ngôn ngữ response sau khi khởi tạo
client.setLanguage('en');
```

> **Ghi chú:** SDK tự động thêm query `lang` vào mọi request.

---

## 📚 API Reference

### 1. Events

Quản lý sự kiện/lớp học.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `create(data)` | `POST /events` | Tạo event mới |
| `list(params?)` | `GET /events` | Danh sách events (phân trang) |
| `get(eventId)` | `GET /events/:eventId` | Lấy event theo ID |
| `update(eventId, data)` | `PATCH /events/:eventId` | Cập nhật event |
| `delete(eventId)` | `DELETE /events/:eventId` | Xóa event |
| `getParticipantStats(eventId)` | `GET /events/:eventId/participants/stats` | Thống kê participants |

**Ví dụ:**

```typescript
import type { CreateEventParams, EventSettings } from '@ermisnetwork/vcr-client';

const payload: CreateEventParams = {
  title: 'Math 101',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T10:00:00Z',
  settings: {
    recordingEnabled: true,
    chatEnabled: true,
    maxParticipants: 50,
  } satisfies EventSettings,
};

const event = await client.events.create(payload);
console.log(event.joinLink); // Link tham gia
```

---

### 2. Registrants

Quản lý học viên/người tham gia và moderation.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `create(eventId, data)` | `POST /events/:eventId/registrants` | Thêm học viên |
| `bulkCreate(eventId, payload)` | `POST /events/:eventId/registrants/bulk` | Thêm nhiều học viên (max 100) |
| `createMock(eventId, count)` | `POST /events/:eventId/registrants/mock` | Tạo học viên giả để test |
| `list(eventId, params?)` | `GET /events/:eventId/registrants` | Danh sách học viên |
| `update(eventId, registrantId, data)` | `PATCH /events/:eventId/registrants/:id` | Cập nhật học viên |
| `delete(eventId, registrantId)` | `DELETE /events/:eventId/registrants/:id` | Xóa học viên |
| `kick(eventId, registrantId, reason?)` | `POST .../kick` | Đuổi khỏi phòng (có thể vào lại) |
| `ban(eventId, registrantId, reason?)` | `POST .../ban` | Cấm tham gia (không vào lại được) |
| `unban(eventId, registrantId)` | `POST .../unban` | Bỏ cấm |
| `toggleChat(eventId, registrantId, blocked)` | `POST .../chat/toggle` | Bật/tắt quyền chat |

**Ví dụ:**

```typescript
import type { CreateRegistrantParams, RegistrantRole } from '@ermisnetwork/vcr-client';

// Thêm 1 học viên
const registrant = await client.registrants.create(event._id, {
  authId: 'user_123',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  role: 'student' satisfies RegistrantRole,
});

// Bulk create (tối đa 100)
const result = await client.registrants.bulkCreate(event._id, {
  registrants: [
    { authId: 'u1', firstName: 'A', lastName: 'One', role: 'student' },
    { authId: 'u2', firstName: 'B', lastName: 'Two', role: 'student' },
  ],
});
console.log(`Created: ${result.created}, Failed: ${result.failed}`);

// Moderation
await client.registrants.kick(event._id, registrant._id, 'Vi phạm nội quy');
await client.registrants.toggleChat(event._id, registrant._id, true); // Block chat
await client.registrants.ban(event._id, registrant._id, 'Spam');
```

---

### 3. Documents

Quản lý tài liệu/file đính kèm cho events.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `upload(eventId, options, onProgress?)` | `POST /events/:eventId/documents` | Upload tài liệu |
| `list(eventId, options?)` | `GET /events/:eventId/documents` | Danh sách tài liệu |
| `getById(eventId, documentId)` | `GET /events/:eventId/documents/:id` | Lấy tài liệu theo ID |
| `getDownloadUrl(eventId, documentId)` | `GET .../download` | Lấy URL download (hết hạn sau 1 giờ) |
| `update(eventId, documentId, updates)` | `PATCH /events/:eventId/documents/:id` | Cập nhật metadata |
| `delete(eventId, documentId)` | `DELETE /events/:eventId/documents/:id` | Xóa tài liệu |
| `reorder(eventId, orders)` | `PATCH .../reorder` | Sắp xếp lại thứ tự |

**Ví dụ:**

```typescript
import type { UploadDocumentOptions, EventDocument } from '@ermisnetwork/vcr-client';

// Upload (Browser)
const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
const file = fileInput.files![0];

const document = await client.documents.upload(
  eventId,
  {
    file,
    title: 'Bài giảng tuần 1',
    description: 'Tài liệu hướng dẫn',
  },
  (progress) => {
    const percent = (progress.loaded / progress.total) * 100;
    console.log(`Upload: ${percent.toFixed(1)}%`);
  }
);

// Danh sách tài liệu
const { documents, total } = await client.documents.list(eventId);

// Bao gồm cả tài liệu đã ẩn
const { documents: allDocs } = await client.documents.list(eventId, {
  includeInactive: true,
});

// Download
const downloadUrl = await client.documents.getDownloadUrl(eventId, document._id);
window.open(downloadUrl, '_blank');

// Cập nhật
await client.documents.update(eventId, document._id, {
  title: 'Tiêu đề mới',
  isActive: false, // Ẩn tài liệu
});

// Sắp xếp lại
await client.documents.reorder(eventId, [
  { documentId: 'doc1', displayOrder: 1 },
  { documentId: 'doc2', displayOrder: 2 },
  { documentId: 'doc3', displayOrder: 3 },
]);

// Xóa
await client.documents.delete(eventId, document._id);
```

---

### 4. Rewards

Quản lý phần thưởng.

> **Ownership**: chỉ Update/Delete reward do **API Key của bạn** tạo.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `create(data)` | `POST /event-rewards` | Tạo reward (multipart/form-data) |
| `list(params?)` | `GET /event-rewards` | Danh sách rewards |
| `get(rewardId)` | `GET /event-rewards/:id` | Lấy reward theo ID |
| `update(rewardId, data)` | `PATCH /event-rewards/:id` | Cập nhật reward |
| `delete(rewardId)` | `DELETE /event-rewards/:id` | Xóa reward |

**Ví dụ:**

```typescript
// Tạo reward
const reward = await client.rewards.create({
  file: imageFile, // File ảnh
  name: 'Gold Star',
  description: 'Giải thưởng xuất sắc',
});

// Danh sách rewards
const { data: rewards } = await client.rewards.list();
```

---

### 5. Ratings (Read-only)

Xem đánh giá của event.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `list(eventId)` | `GET /events/:eventId/ratings` | Danh sách đánh giá |

**Ví dụ:**

```typescript
const ratings = await client.ratings.list(eventId);
console.log(`Average: ${ratings.averageClassQuality}`);
console.log(`Total: ${ratings.totalRatings} ratings`);
```

---

## 📝 Types

Import types trực tiếp từ package:

```typescript
import type {
  // Events
  Event,
  CreateEventParams,
  UpdateEventParams,
  ListEventsParams,
  EventSettings,
  ParticipantStats,
  
  // Registrants
  Registrant,
  RegistrantRole,
  CreateRegistrantParams,
  UpdateRegistrantParams,
  ListRegistrantsParams,
  BulkCreateRegistrantsParams,
  BulkCreateRegistrantsResult,
  
  // Documents
  EventDocument,
  UploadDocumentOptions,
  UpdateDocumentParams,
  ListDocumentsOptions,
  DocumentListResponse,
  DocumentReorderItem,
  ProgressEvent,
  
  // Rewards
  Reward,
  CreateRewardParams,
  UpdateRewardParams,
  ListRewardsParams,
  
  // Ratings
  Rating,
  RatingList,
  
  // Common
  PaginatedResponse,
  ApiResponse,
  PaginationMeta,
} from '@ermisnetwork/vcr-client';
```

---

## 🔧 Error Handling

SDK cung cấp các error classes cụ thể cho từng loại lỗi:

```typescript
import {
  VCRError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '@ermisnetwork/vcr-client';

try {
  await client.events.get('invalid-id');
} catch (error) {
  if (error instanceof AuthenticationError) {
    // 401 - API Key không hợp lệ
    console.error('Authentication failed:', error.message);
  } else if (error instanceof PermissionError) {
    // 403 - Không có quyền
    console.error('Permission denied:', error.message);
  } else if (error instanceof NotFoundError) {
    // 404 - Không tìm thấy
    console.error('Not found:', error.message);
  } else if (error instanceof RateLimitError) {
    // 429 - Vượt quá rate limit
    console.error('Rate limited:', error.message);
  } else if (error instanceof ServerError) {
    // 5xx - Lỗi server
    console.error('Server error:', error.message);
  } else if (error instanceof VCRError) {
    // Lỗi khác
    console.error(`Error ${error.statusCode}:`, error.message);
  }
}
```

---

## 📊 Ví dụ End-to-End

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';
import type { CreateEventParams, CreateRegistrantParams } from '@ermisnetwork/vcr-client';

async function main() {
  // 1. Khởi tạo client
  const client = createVCRClient({
    apiKey: process.env.VCR_API_KEY!,
    baseUrl: 'https://api.vcr.example.com',
  });

  // 2. Tạo event
  const eventPayload: CreateEventParams = {
    title: 'Lớp Toán 101',
    startTime: '2026-01-15T09:00:00Z',
    endTime: '2026-01-15T10:00:00Z',
    settings: {
      recordingEnabled: true,
      chatEnabled: true,
    },
  };
  const event = await client.events.create(eventPayload);
  console.log('Created event:', event._id);

  // 3. Thêm học viên
  const registrantPayload: CreateRegistrantParams = {
    authId: 'user_123',
    firstName: 'Nguyễn',
    lastName: 'Văn A',
    email: 'a@example.com',
    role: 'student',
  };
  const registrant = await client.registrants.create(event._id, registrantPayload);
  console.log('Added registrant:', registrant._id);

  // 4. Upload tài liệu
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (fileInput.files?.length) {
    const document = await client.documents.upload(event._id, {
      file: fileInput.files[0],
      title: 'Bài giảng',
    });
    console.log('Uploaded document:', document._id);
  }

  // 5. Lấy danh sách tài liệu
  const { documents, total } = await client.documents.list(event._id);
  console.log(`Total documents: ${total}`);

  // 6. Moderation
  await client.registrants.toggleChat(event._id, registrant._id, true);
  console.log('Blocked chat for registrant');

  // 7. Xem thống kê
  const stats = await client.events.getParticipantStats(event._id);
  console.log('Participant stats:', stats);
}

main().catch(console.error);
```

---

## ⚠️ Ownership & Limitations

### Ownership
- Bạn chỉ có thể **Update/Delete** resources do **API Key của bạn** tạo
- Đặc biệt áp dụng cho Rewards; Events/Registrants tùy backend rule

### Không hỗ trợ qua API Key
- Breakout rooms
- In-room actions (phát thưởng trong phòng, timer, whiteboard...)
- Thay đổi quyền realtime
- Các endpoint cần user session context

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/ermisnetwork/ermis-classroom-sdk/issues)
- **Documentation:** [Docs](https://docs.ermis.network)

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.
