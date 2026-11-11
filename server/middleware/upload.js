import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxBytes, files: 1, fields: 0 },
});

/** Accepts exactly one file in the "file" field; content checks happen in fileStorage. */
export function singleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return next(
        new ApiError(
          tooBig ? 413 : 400,
          tooBig ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD',
          tooBig ? `Files can be up to ${Math.round(env.uploads.maxBytes / 1048576)} MB.` : 'Upload one file in the "file" field.',
        ),
      );
    }
    next(err);
  });
}
