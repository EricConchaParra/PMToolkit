import"./assets/modulepreload-polyfill.js";import{p as Q,h as ot,m as it,e as l,g as q,a as A,b as P,c as rt,d as ct,f as lt,n as dt,i as ut}from"./assets/tagEditor.js";import{s as g,a as D}from"./assets/storage.js";import{g as X}from"./assets/issueType.js";const H={async getHost(){const p=await g.get(["et_jira_host"]);return p.et_jira_host?p.et_jira_host:window.location.hostname&&window.location.hostname.endsWith(".atlassian.net")?window.location.hostname:"jira.atlassian.net"},async fetchIssueDetails(p){var u,b,k,I,T,j,_,S;const h=await this.getHost(),d=p.split(":").pop();try{const $=await fetch(`https://${h}/rest/api/2/issue/${d}?fields=summary,assignee,status,issuetype`,{credentials:"include"});if(!$.ok)return null;const f=await $.json();return{summary:((u=f.fields)==null?void 0:u.summary)||"",assignee:((k=(b=f.fields)==null?void 0:b.assignee)==null?void 0:k.displayName)||"Unassigned",status:{name:((T=(I=f.fields)==null?void 0:I.status)==null?void 0:T.name)||"Unknown",category:((S=(_=(j=f.fields)==null?void 0:j.status)==null?void 0:_.statusCategory)==null?void 0:S.key)||"new"},issueType:X(f)}}catch($){return console.error("PMsToolKit: API fetch error",$),null}},async getBoardIdForProject(p){var h,d;try{const u=await fetch(`${window.location.origin}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(p)}&type=scrum&maxResults=1`,{credentials:"same-origin",headers:{Accept:"application/json"}});return u.ok&&((d=(h=(await u.json()).values)==null?void 0:h[0])==null?void 0:d.id)||null}catch(u){return console.error("PMsToolKit: Board fetch error",u),null}},async getLastClosedSprints(p,h=3){try{const d=await fetch(`${window.location.origin}/rest/agile/1.0/board/${p}/sprint?state=closed&maxResults=50`,{credentials:"same-origin",headers:{Accept:"application/json"}});return d.ok?((await d.json()).values||[]).slice(-h):[]}catch(d){return console.error("PMsToolKit: Sprints fetch error",d),[]}}},gt={jira_hide_elements:!0,jira_collapse_sidebar:!0,jira_manual_menu:!0,jira_copy_for_slack:!0,jira_quick_notes_list:!0,jira_quick_notes_ticket:!0,jira_breadcrumb_copy:!0,jira_age_indicators:!0,jira_board_age:!0,jira_sp_summary:!0,jira_native_table_icons:!0,zoom_copy_transcript:!0,github_pr_link:!1};document.addEventListener("DOMContentLoaded",async()=>{const p=document.getElementById("notes-view"),h=document.getElementById("settings-view"),d=document.getElementById("settings-toggle"),u=document.getElementById("sync-notes-btn"),b=document.getElementById("view-title"),k=document.getElementById("notes-list"),I=document.getElementById("notes-count"),T=document.getElementById("search"),j=document.getElementById("test-notification-btn"),_=document.getElementById("notif-status"),S=document.getElementById("github-pr-link-toggle"),$=document.getElementById("github-pat-section"),f=document.getElementById("github-pat-input"),Y=document.getElementById("github-pat-save-btn"),v=document.getElementById("github-pat-status");let O=[],L=!1,K="jira.atlassian.net",w={},R=null;function B(e){L||(b.textContent=e)}function Z(e=[],t=""){const s=rt(e,w);return s.length?`
            <div class="et-tag-read-list ${t}">
                ${s.map(n=>`
                    <span class="et-tag-chip" style="${ct(n.color)}">
                        <span class="et-tag-chip-dot"></span>
                        <span class="et-tag-chip-label">${l(n.label)}</span>
                    </span>
                `).join("")}
            </div>
        `:""}function U(){const e=O.filter(t=>it(t,T.value));tt(e)}async function C(){const e=await g.getAll(),t=Q(e),s={...t.metaMap};w=t.tagDefs;const n=t.allKeys.filter(a=>{const r=s[a];return!r||!r.status||!Object.prototype.hasOwnProperty.call(r,"issueType")});if(n.length>0){B("⏳ Loading info...");for(const a of n){const r=await H.fetchIssueDetails(a);r&&(s[a]={summary:r.summary,assignee:r.assignee,status:r.status,issueType:r.issueType},await g.set({[`meta_jira:${a}`]:s[a]}))}B("📝 My Notes")}O=t.allKeys.map(a=>({key:a,text:t.notesMap[a]||"",reminder:t.remindersMap[a]||null,tags:t.tagsMap[a]||[],meta:s[a]||null})).sort((a,r)=>r.key.localeCompare(a.key)),U()}function tt(e){if(k.innerHTML="",I.textContent=e.length,e.length===0){const t=!!T.value.trim();k.innerHTML=`
                <div class="empty-state">
                    <div class="emoji">${t?"🔎":"📝"}</div>
                    <p>${t?"No notes, reminders or tags match your search.":"No notes, reminders or tags found."}</p>
                </div>
            `;return}e.forEach(t=>{const s=document.createElement("div");s.className="note-item";function n(){const r=t.reminder&&t.reminder<Date.now(),M=t.reminder?`
                    <div class="note-reminder-badge ${r?"overdue":"future"}">
                        <span>🔔</span> ${l(new Date(t.reminder).toLocaleString())}
                    </div>
                `:"",x=t.meta?t.meta.summary:"No summary loaded",E=t.meta?t.meta.assignee:"Unknown assignee",o=t.meta?t.meta.status:null,i=X(t.meta);let c="";if(o){const y=o.name.toLowerCase();y.includes("blocked")||y.includes("hold")?c="status-blocked":y.includes("review")||y.includes("reviewing")?c="status-inreview":y.includes("qa")||y.includes("test")?c="status-qa":(y.includes("in progress")||y.includes("progress"))&&(c="status-inprogress-specific")}const N=o?`
                    <div class="note-status-badge status-${l(o.category)} ${c}">${l(o.name)}</div>
                `:"",st=i.iconUrl?`
                    <img class="note-type-icon" src="${l(i.iconUrl)}" alt="${l(i.name||"Issue type")}" title="${l(i.name||"Issue type")}">
                `:"",F=K;s.innerHTML=`
                    <div class="note-header">
                        <div class="note-header-main">
                            ${st}
                            <a href="https://${F}/browse/${t.key}" target="_blank" class="note-key">${l(t.key)}</a>
                            ${N}
                        </div>
                        <div class="note-actions">
                            <button class="icon-only edit-btn" title="Edit note">✏️</button>
                            <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                            <button class="icon-only delete-btn" title="Delete tracked item">🗑️</button>
                        </div>
                    </div>
                    <div class="note-summary" title="${l(x)}">${l(x)}</div>
                    <div class="note-meta">
                        <div class="note-meta-bottom">
                            👤 ${l(E)}
                        </div>
                        ${Z(t.tags,"popup-note-tags")}
                    </div>
                    ${t.text?`<div class="note-text">${l(t.text)}</div>`:""}
                    ${M}
                `,s.querySelector(".edit-btn").onclick=a,s.querySelector(".copy-btn").onclick=y=>{const m=y.currentTarget;if(m.dataset.isCopying)return;m.dataset.isCopying="true";const V=`https://${F}/browse/${t.key}`,G=`${t.key} - ${x}`,nt=`<a href="${V}">${l(G)}</a>`,J=`[${G}](${V})`,W=m.textContent,at=[new ClipboardItem({"text/plain":new Blob([J],{type:"text/plain"}),"text/html":new Blob([nt],{type:"text/html"})})];navigator.clipboard.write(at).then(()=>{m.textContent="✅",setTimeout(()=>{m.textContent=W,delete m.dataset.isCopying},1500)}).catch(()=>{navigator.clipboard.writeText(J).then(()=>{m.textContent="✅",setTimeout(()=>{m.textContent=W,delete m.dataset.isCopying},1500)}).catch(()=>{delete m.dataset.isCopying})})},s.querySelector(".delete-btn").onclick=async()=>{confirm(`Delete note, reminder, and tags for ${t.key}?`)&&(await g.remove([q(t.key),A(t.key),P(t.key)]),await C())}}function a(){const r=o=>{if(!o)return"";const i=new Date(o);return i.setMinutes(i.getMinutes()-i.getTimezoneOffset()),i.toISOString().slice(0,16)};let M=t.tags.slice();s.innerHTML=`
                    <div class="popup-edit-card">
                        <div class="note-header popup-edit-header">
                            <span class="note-key">${l(t.key)}</span>
                        </div>
                        <textarea class="edit-note-text popup-edit-text"></textarea>
                        <div class="popup-edit-field">
                            <label>Reminder</label>
                            <input type="datetime-local" class="edit-reminder-input popup-edit-reminder" value="${r(t.reminder)}">
                        </div>
                        <div class="popup-edit-field">
                            <label>Tags</label>
                            <div class="popup-edit-tags-host"></div>
                        </div>
                        <div class="popup-edit-actions">
                            <button class="cancel-edit-btn">Cancel</button>
                            <button class="save-edit-btn">Save</button>
                        </div>
                    </div>
                `;const x=s.querySelector(".edit-note-text");x.value=t.text||"";const E=lt(s.querySelector(".popup-edit-tags-host"),{value:t.tags,tagDefs:w,placeholder:"Add or create tags...",onCreateTag:async(o,i)=>{const c=await ut(o,i);return c?(w={...w,[c.normalized]:{label:c.label,color:c.color}},E.setTagDefs(w),c):!1},onChange:o=>{M=o.slice()}});s.querySelector(".cancel-edit-btn").onclick=()=>{E.destroy(),n()},s.querySelector(".save-edit-btn").onclick=async()=>{const o=x.value.trim(),i=s.querySelector(".edit-reminder-input").value,c=dt(M,w);if(o?await g.set({[q(t.key)]:o}):await g.remove(q(t.key)),i){const N=new Date(i).getTime();await g.set({[A(t.key)]:N})}else await g.remove(A(t.key));c.length?await g.set({[P(t.key)]:c}):await g.remove(P(t.key)),t.text=o,t.reminder=i?new Date(i).getTime():null,t.tags=c,E.destroy(),await C()}}n(),k.appendChild(s)})}d.addEventListener("click",()=>{L=!L,L?(p.style.display="none",h.style.display="block",b.textContent="⚙️ Settings",d.textContent="📝"):(p.style.display="flex",h.style.display="none",b.textContent="📝 My Notes",d.textContent="⚙️")}),document.getElementById("open-exporter-btn").addEventListener("click",()=>{const e=chrome.runtime.getURL("src/pages/analytics/index.html");chrome.tabs.create({url:e})}),u.addEventListener("click",async()=>{if(u.classList.contains("syncing-spin"))return;u.classList.add("syncing-spin"),B("⏳ Syncing statuses...");const e=await g.getAll(),t=Q(e);for(const s of t.allKeys)try{const n=await H.fetchIssueDetails(s);if(!n)continue;await g.set({[`meta_jira:${s}`]:{summary:n.summary,assignee:n.assignee,status:n.status,issueType:n.issueType}})}catch(n){console.warn(`Failed to sync details for ${s}`,n)}u.classList.remove("syncing-spin"),B("📝 My Notes"),await C()}),T.addEventListener("input",U);async function et(){const e=await D.get(gt);document.querySelectorAll("input[data-setting]").forEach(s=>{const n=s.getAttribute("data-setting");Object.prototype.hasOwnProperty.call(e,n)&&(s.checked=e[n])});const t=e.github_pr_link===!0;if(z(t),t){const s=await D.get({github_pat:""});s.github_pat&&(f.value=s.github_pat)}}document.querySelectorAll("input[data-setting]").forEach(e=>{e.addEventListener("change",async()=>{const t=e.getAttribute("data-setting");await D.set({[t]:e.checked})})}),j.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"TEST_NOTIFICATION"}),_.textContent="Test signal sent to background...",_.style.display="block",setTimeout(()=>{_.style.display="none"},3e3)});function z(e){$.style.display=e?"block":"none"}S.addEventListener("change",()=>{z(S.checked)}),Y.addEventListener("click",async()=>{const e=f.value.trim();if(!e){v.textContent="Please enter a token.",v.style.color="#ff5630",v.style.display="block";return}await D.set({github_pat:e}),v.textContent="✅ Token saved!",v.style.color="#36b37e",v.style.display="block",setTimeout(()=>{v.style.display="none"},2500)}),chrome.storage.onChanged.addListener((e,t)=>{t==="local"&&ot(e,{includeMeta:!0})&&(clearTimeout(R),R=setTimeout(()=>{C()},120))});try{K=await H.getHost()}catch(e){console.error(e)}await C(),await et()});
