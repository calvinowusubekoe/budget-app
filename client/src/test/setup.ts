/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

// Register jest-dom matchers on this runner's own `expect`, rather than through
// '@testing-library/jest-dom/vitest', whose separate `vitest` import can resolve
// to another module instance after a workspace reinstall.
expect.extend(matchers);

afterEach(() => cleanup());
