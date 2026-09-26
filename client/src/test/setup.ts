import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library removes rendered pages automatically only when test globals
// are on. They are off here, so each test starts from an empty document only
// because of this line.
afterEach(cleanup);
