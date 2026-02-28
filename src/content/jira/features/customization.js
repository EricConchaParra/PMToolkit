import { storage } from '../../../common/storage';

export const CustomizationFeature = {
    hideHeaderElements() {
        // Target specific Rovo elements and their containers
        const rovoSelectors = [
            '[data-testid="atlassian-navigation.ui.conversation-assistant.app-navigation-ai-mate"]',
            '[data-testid="platform-ai-button"]'
        ];

        rovoSelectors.forEach(s => {
            const el = document.querySelector(s);
            if (el) {
                // Hide the element itself
                el.style.display = 'none';

                // Robustly hide parent containers that might still be visible
                const listItem = el.closest('[role="listitem"]');
                if (listItem) listItem.style.display = 'none';

                const floatingWrapper = el.closest('div._1e0c1txw');
                if (floatingWrapper && floatingWrapper.querySelector('[data-testid="platform-ai-button"]')) {
                    floatingWrapper.style.display = 'none';
                }
            }
        });

        // Other elements to hide
        const otherSelectors = [
            '[data-testid="atlassian-navigation--create-button"]',
            'button[aria-label*="Ask Rovo"]'
        ];
        otherSelectors.forEach(s => {
            const el = document.querySelector(s);
            if (el) el.style.display = 'none';
        });
    },

    collapseSidebar() {
        if (window._etSidebarCollapsed) return;
        const sidebar = document.querySelector('[data-testid="page-layout.sidebar"]');
        if (sidebar && sidebar.offsetWidth > 100) {
            const collapseBtn = Array.from(document.querySelectorAll('button')).find(btn =>
                btn.getAttribute('aria-label')?.includes('Collapse sidebar')
            );
            if (collapseBtn) {
                collapseBtn.click();
                window._etSidebarCollapsed = true;
            }
        }
    },

    async injectManualMenu() {
        if (_etCachedStarredItems) {
            renderStarredItemsMenu(_etCachedStarredItems);
            return;
        }

        // Try to load manual items first
        const res = await storage.get(['et_manual_menu_items', 'et_starred_items']);
        if (res.et_manual_menu_items) {
            _etCachedStarredItems = res.et_manual_menu_items;
        } else if (res.et_starred_items) {
            // Migration
            _etCachedStarredItems = res.et_starred_items;
            await storage.set({ et_manual_menu_items: res.et_starred_items });
        } else {
            _etCachedStarredItems = [];
        }
        renderStarredItemsMenu(_etCachedStarredItems);
    }
};

let _etCachedStarredItems = null;

function renderStarredItemsMenu(items) {
    const topNav = document.querySelector('[data-testid="page-layout.top-nav"]');
    if (!topNav) return;

    let menuWrapper = document.querySelector('.et-header-menu-wrapper');
    if (!menuWrapper) {
        menuWrapper = document.createElement('div');
        menuWrapper.className = 'et-header-menu-wrapper';
        menuWrapper.style.display = 'flex';
        menuWrapper.style.alignItems = 'center';
        menuWrapper.style.position = 'relative';

        const productHome = topNav.querySelector('[data-testid="atlassian-navigation--product-home--container"]');
        if (productHome) {
            productHome.parentNode.insertBefore(menuWrapper, productHome.nextSibling);
        } else {
            topNav.prepend(menuWrapper);
        }
    }

    const linksHash = (items || []).map(i => i.href + i.title).join('|');
    let menu = menuWrapper.querySelector('.et-header-starred-menu');

    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'et-header-starred-menu';
        menuWrapper.appendChild(menu);
    }

    if (menu.getAttribute('data-links-hash') !== linksHash) {
        menu.innerHTML = '';
        (items || []).forEach(item => {
            const a = document.createElement('a');
            a.className = 'et-header-starred-item';
            a.href = item.href;
            a.textContent = item.title;
            menu.appendChild(a);
        });
        menu.setAttribute('data-links-hash', linksHash);
    }

    // Edit Button (⋮)
    let editBtn = menuWrapper.querySelector('.et-menu-edit-btn');
    if (!editBtn) {
        editBtn = document.createElement('button');
        editBtn.className = 'et-menu-edit-btn';
        editBtn.innerHTML = '⋮';
        editBtn.title = 'PMsToolKit: Edit Menu';
        menuWrapper.appendChild(editBtn);

        // Menu Manager Popup
        const popup = document.createElement('div');
        popup.className = 'et-menu-manager-popup';
        popup.innerHTML = `
            <h4>Manage Jira Menu</h4>
            <div class="et-menu-manager-add-section">
                <input type="text" id="et-menu-new-title" placeholder="Title">
                <input type="text" id="et-menu-new-url" placeholder="URL">
                <button class="et-notes-save-btn" id="et-menu-add-save">Add Current Page</button>
            </div>
            <div class="et-menu-manager-list"></div>
        `;
        menuWrapper.appendChild(popup);

        editBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isVisible = popup.classList.toggle('visible');
            if (isVisible) {
                const titleInput = popup.querySelector('#et-menu-new-title');
                const urlInput = popup.querySelector('#et-menu-new-url');
                titleInput.value = document.title.replace(' - Jira', '');
                urlInput.value = window.location.pathname + window.location.search;
                renderManagerList(popup, items);
            }
        };

        const saveBtn = popup.querySelector('#et-menu-add-save');
        saveBtn.onclick = () => {
            const title = popup.querySelector('#et-menu-new-title').value.trim();
            const url = popup.querySelector('#et-menu-new-url').value.trim();
            if (title && url) {
                // Use the latest _etCachedStarredItems instead of the captured 'items' param
                const currentItems = _etCachedStarredItems || [];
                const newItems = [...currentItems, { title, href: url }];
                saveMenuItems(newItems);

                // Keep the popup visible but reset the inputs and re-render the list
                popup.querySelector('#et-menu-new-title').value = '';
                popup.querySelector('#et-menu-new-url').value = '';
                renderManagerList(popup, newItems);
            }
        };

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!menuWrapper.contains(e.target)) {
                popup.classList.remove('visible');
            }
        });
    }
}

function renderManagerList(popup, items) {
    const list = popup.querySelector('.et-menu-manager-list');
    list.innerHTML = '';

    let draggedItemIndex = null;

    (items || []).forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'et-menu-manager-item';
        div.setAttribute('draggable', 'true');
        div.setAttribute('data-index', index);

        div.innerHTML = `
            <div style="display: flex; align-items: center; overflow: hidden;">
                <span class="et-menu-drag-handle">≡</span>
                <span title="${item.href}">${item.title}</span>
            </div>
            <button class="et-menu-manager-delete" data-index="${index}" title="Remove">🗑️</button>
        `;

        // Delete action
        div.querySelector('.et-menu-manager-delete').onclick = () => {
            const newItems = items.filter((_, i) => i !== index);
            saveMenuItems(newItems);
            renderManagerList(popup, newItems);
        };

        // Drag and Drop Events
        div.addEventListener('dragstart', (e) => {
            draggedItemIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            // Need to set data for Firefox compatibility
            e.dataTransfer.setData('text/plain', index);
            setTimeout(() => div.classList.add('dragging'), 0);
        });

        div.addEventListener('dragend', () => {
            div.classList.remove('dragging');
            list.querySelectorAll('.et-menu-manager-item').forEach(el => el.classList.remove('drag-over'));
            draggedItemIndex = null;
        });

        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedItemIndex !== index) {
                div.classList.add('drag-over');
            }
        });

        div.addEventListener('dragleave', () => {
            div.classList.remove('drag-over');
        });

        div.addEventListener('drop', (e) => {
            e.preventDefault();
            div.classList.remove('drag-over');

            if (draggedItemIndex !== null && draggedItemIndex !== index) {
                const newItems = [...items];
                const [movedItem] = newItems.splice(draggedItemIndex, 1);
                newItems.splice(index, 0, movedItem);

                saveMenuItems(newItems);
                renderManagerList(popup, newItems);
            }
        });

        list.appendChild(div);
    });
}

function saveMenuItems(items) {
    _etCachedStarredItems = items;
    storage.set({ et_manual_menu_items: items });
    renderStarredItemsMenu(items);
}
