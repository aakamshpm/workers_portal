import { mount } from "../shared/mount";
import { captureInstallPrompt, registerServiceWorker } from "../shared/install";
import WorkerApp from "./App";

// Before React draws, because the browser's install offer can come at once.
captureInstallPrompt();
registerServiceWorker("worker");

mount(<WorkerApp />, "/worker");
