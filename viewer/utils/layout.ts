import { resizeService } from './resize.js';

class LayoutService {
  init() {
    // Add resize handle between left and right panes
    const appContainer = document.getElementById('app-container');
    const leftPane = document.getElementById('left-pane');
    if (appContainer && leftPane) {
      const handle = resizeService.createHandle(appContainer, leftPane, 'leftPaneWidth');
      handle.dataset.storageKey = 'leftPaneWidth';
      handle.classList.add('main-resize-handle');
      appContainer.insertBefore(handle, leftPane.nextSibling);
    }
  }
}

export const layoutService = new LayoutService();
