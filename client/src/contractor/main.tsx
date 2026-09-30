import { mount } from "../shared/mount";
import { captureInstallPrompt, registerServiceWorker } from "../shared/install";
import ContractorApp from "./App";

// Before React draws, because the browser's install offer can come at once.
captureInstallPrompt();
registerServiceWorker("contractor");

mount(<ContractorApp />, "/contractor");
