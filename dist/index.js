import"./assets/modulepreload-polyfill.js";import{p as W,h as st,m as nt,e as g,g as q,a as A,b as P,c as at,d as ot,f as it,n as rt,i as ct}from"./assets/tagEditor.js";import{s as l,a as N}from"./assets/storage.js";const H={async getHost(){const d=await l.get(["et_jira_host"]);return d.et_jira_host?d.et_jira_host:window.location.hostname&&window.location.hostname.endsWith(".atlassian.net")?window.location.hostname:"jira.atlassian.net"},async fetchIssueDetails(d){var c,f,k,I,T,L,_,S;const h=await this.getHost(),r=d.split(":").pop();try{const $=await fetch(`https://${h}/rest/api/2/issue/${r}?fields=summary,assignee,status`,{credentials:"include"});if(!$.ok)return null;const b=await $.json();return{summary:((c=b.fields)==null?void 0:c.summary)||"",assignee:((k=(f=b.fields)==null?void 0:f.assignee)==null?void 0:k.displayName)||"Unassigned",status:{name:((T=(I=b.fields)==null?void 0:I.status)==null?void 0:T.name)||"Unknown",category:((S=(_=(L=b.fields)==null?void 0:L.status)==null?void 0:_.statusCategory)==null?void 0:S.key)||"new"}}}catch($){return console.error("PMsToolKit: API fetch error",$),null}},async getBoardIdForProject(d){var h,r;try{const c=await fetch(`${window.location.origin}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(d)}&type=scrum&maxResults=1`,{credentials:"same-origin",headers:{Accept:"application/json"}});return c.ok&&((r=(h=(await c.json()).values)==null?void 0:h[0])==null?void 0:r.id)||null}catch(c){return console.error("PMsToolKit: Board fetch error",c),null}},async getLastClosedSprints(d,h=3){try{const r=await fetch(`${window.location.origin}/rest/agile/1.0/board/${d}/sprint?state=closed&maxResults=50`,{credentials:"same-origin",headers:{Accept:"application/json"}});return r.ok?((await r.json()).values||[]).slice(-h):[]}catch(r){return console.error("PMsToolKit: Sprints fetch error",r),[]}}},lt={jira_hide_elements:!0,jira_collapse_sidebar:!0,jira_manual_menu:!0,jira_copy_for_slack:!0,jira_quick_notes_list:!0,jira_quick_notes_ticket:!0,jira_breadcrumb_copy:!0,jira_age_indicators:!0,jira_board_age:!0,jira_sp_summary:!0,jira_native_table_icons:!0,zoom_copy_transcript:!0,github_pr_link:!1};document.addEventListener("DOMContentLoaded",async()=>{const d=document.getElementById("notes-view"),h=document.getElementById("settings-view"),r=document.getElementById("settings-toggle"),c=document.getElementById("sync-notes-btn"),f=document.getElementById("view-title"),k=document.getElementById("notes-list"),I=document.getElementById("notes-count"),T=document.getElementById("search"),L=document.getElementById("test-notification-btn"),_=document.getElementById("notif-status"),S=document.getElementById("github-pr-link-toggle"),$=document.getElementById("github-pat-section"),b=document.getElementById("github-pat-input"),Q=document.getElementById("github-pat-save-btn"),v=document.getElementById("github-pat-status");let K=[],j=!1,O="jira.atlassian.net",w={},R=null;function B(e){j||(f.textContent=e)}function X(e=[],t=""){const s=at(e,w);return s.length?`
            <div class="et-tag-read-list ${t}">
                ${s.map(n=>`
                    <span class="et-tag-chip" style="${ot(n.color)}">
                        <span class="et-tag-chip-dot"></span>
                        <span class="et-tag-chip-label">${g(n.label)}</span>
                    </span>
                `).join("")}
            </div>
        `:""}function U(){const e=K.filter(t=>nt(t,T.value));Y(e)}async function C(){const e=await l.getAll(),t=W(e),s={...t.metaMap};w=t.tagDefs;const n=t.allKeys.filter(a=>!s[a]||!s[a].status);if(n.length>0){B("⏳ Loading info...");for(const a of n){const p=await H.fetchIssueDetails(a);p&&(s[a]={summary:p.summary,assignee:p.assignee,status:p.status},await l.set({[`meta_jira:${a}`]:s[a]}))}B("📝 My Notes")}K=t.allKeys.map(a=>({key:a,text:t.notesMap[a]||"",reminder:t.remindersMap[a]||null,tags:t.tagsMap[a]||[],meta:s[a]||null})).sort((a,p)=>p.key.localeCompare(a.key)),U()}function Y(e){if(k.innerHTML="",I.textContent=e.length,e.length===0){const t=!!T.value.trim();k.innerHTML=`
                <div class="empty-state">
                    <div class="emoji">${t?"🔎":"📝"}</div>
                    <p>${t?"No notes, reminders or tags match your search.":"No notes, reminders or tags found."}</p>
                </div>
            `;return}e.forEach(t=>{const s=document.createElement("div");s.className="note-item";function n(){const p=t.reminder&&t.reminder<Date.now(),M=t.reminder?`
                    <div class="note-reminder-badge ${p?"overdue":"future"}">
                        <span>🔔</span> ${g(new Date(t.reminder).toLocaleString())}
                    </div>
                `:"",x=t.meta?t.meta.summary:"No summary loaded",E=t.meta?t.meta.assignee:"Unknown assignee",i=t.meta?t.meta.status:null;let o="";if(i){const y=i.name.toLowerCase();y.includes("blocked")||y.includes("hold")?o="status-blocked":y.includes("review")||y.includes("reviewing")?o="status-inreview":y.includes("qa")||y.includes("test")?o="status-qa":(y.includes("in progress")||y.includes("progress"))&&(o="status-inprogress-specific")}const u=i?`
                    <div class="note-status-badge status-${g(i.category)} ${o}">${g(i.name)}</div>
                `:"",D=O;s.innerHTML=`
                    <div class="note-header">
                        <div class="note-header-main">
                            <a href="https://${D}/browse/${t.key}" target="_blank" class="note-key">${g(t.key)}</a>
                            ${u}
                        </div>
                        <div class="note-actions">
                            <button class="icon-only edit-btn" title="Edit note">✏️</button>
                            <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                            <button class="icon-only delete-btn" title="Delete tracked item">🗑️</button>
                        </div>
                    </div>
                    <div class="note-summary" title="${g(x)}">${g(x)}</div>
                    <div class="note-meta">
                        <div class="note-meta-bottom">
                            👤 ${g(E)}
                        </div>
                        ${X(t.tags,"popup-note-tags")}
                    </div>
                    ${t.text?`<div class="note-text">${g(t.text)}</div>`:""}
                    ${M}
                `,s.querySelector(".edit-btn").onclick=a,s.querySelector(".copy-btn").onclick=y=>{const m=y.currentTarget;if(m.dataset.isCopying)return;m.dataset.isCopying="true";const F=`https://${D}/browse/${t.key}`,V=`${t.key} - ${x}`,tt=`<a href="${F}">${g(V)}</a>`,G=`[${V}](${F})`,J=m.textContent,et=[new ClipboardItem({"text/plain":new Blob([G],{type:"text/plain"}),"text/html":new Blob([tt],{type:"text/html"})})];navigator.clipboard.write(et).then(()=>{m.textContent="✅",setTimeout(()=>{m.textContent=J,delete m.dataset.isCopying},1500)}).catch(()=>{navigator.clipboard.writeText(G).then(()=>{m.textContent="✅",setTimeout(()=>{m.textContent=J,delete m.dataset.isCopying},1500)}).catch(()=>{delete m.dataset.isCopying})})},s.querySelector(".delete-btn").onclick=async()=>{confirm(`Delete note, reminder, and tags for ${t.key}?`)&&(await l.remove([q(t.key),A(t.key),P(t.key)]),await C())}}function a(){const p=i=>{if(!i)return"";const o=new Date(i);return o.setMinutes(o.getMinutes()-o.getTimezoneOffset()),o.toISOString().slice(0,16)};let M=t.tags.slice();s.innerHTML=`
                    <div class="popup-edit-card">
                        <div class="note-header popup-edit-header">
                            <span class="note-key">${g(t.key)}</span>
                        </div>
                        <textarea class="edit-note-text popup-edit-text"></textarea>
                        <div class="popup-edit-field">
                            <label>Reminder</label>
                            <input type="datetime-local" class="edit-reminder-input popup-edit-reminder" value="${p(t.reminder)}">
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
                `;const x=s.querySelector(".edit-note-text");x.value=t.text||"";const E=it(s.querySelector(".popup-edit-tags-host"),{value:t.tags,tagDefs:w,placeholder:"Add or create tags...",onCreateTag:async(i,o)=>{const u=await ct(i,o);return u?(w={...w,[u.normalized]:{label:u.label,color:u.color}},E.setTagDefs(w),u):!1},onChange:i=>{M=i.slice()}});s.querySelector(".cancel-edit-btn").onclick=()=>{E.destroy(),n()},s.querySelector(".save-edit-btn").onclick=async()=>{const i=x.value.trim(),o=s.querySelector(".edit-reminder-input").value,u=rt(M,w);if(i?await l.set({[q(t.key)]:i}):await l.remove(q(t.key)),o){const D=new Date(o).getTime();await l.set({[A(t.key)]:D})}else await l.remove(A(t.key));u.length?await l.set({[P(t.key)]:u}):await l.remove(P(t.key)),t.text=i,t.reminder=o?new Date(o).getTime():null,t.tags=u,E.destroy(),await C()}}n(),k.appendChild(s)})}r.addEventListener("click",()=>{j=!j,j?(d.style.display="none",h.style.display="block",f.textContent="⚙️ Settings",r.textContent="📝"):(d.style.display="flex",h.style.display="none",f.textContent="📝 My Notes",r.textContent="⚙️")}),document.getElementById("open-exporter-btn").addEventListener("click",()=>{const e=chrome.runtime.getURL("src/pages/analytics/index.html");chrome.tabs.create({url:e})}),c.addEventListener("click",async()=>{if(c.classList.contains("syncing-spin"))return;c.classList.add("syncing-spin"),B("⏳ Syncing statuses...");const e=await l.getAll(),t=W(e);for(const s of t.allKeys)try{const n=await H.fetchIssueDetails(s);if(!n)continue;await l.set({[`meta_jira:${s}`]:{summary:n.summary,assignee:n.assignee,status:n.status}})}catch(n){console.warn(`Failed to sync details for ${s}`,n)}c.classList.remove("syncing-spin"),B("📝 My Notes"),await C()}),T.addEventListener("input",U);async function Z(){const e=await N.get(lt);document.querySelectorAll("input[data-setting]").forEach(s=>{const n=s.getAttribute("data-setting");Object.prototype.hasOwnProperty.call(e,n)&&(s.checked=e[n])});const t=e.github_pr_link===!0;if(z(t),t){const s=await N.get({github_pat:""});s.github_pat&&(b.value=s.github_pat)}}document.querySelectorAll("input[data-setting]").forEach(e=>{e.addEventListener("change",async()=>{const t=e.getAttribute("data-setting");await N.set({[t]:e.checked})})}),L.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"TEST_NOTIFICATION"}),_.textContent="Test signal sent to background...",_.style.display="block",setTimeout(()=>{_.style.display="none"},3e3)});function z(e){$.style.display=e?"block":"none"}S.addEventListener("change",()=>{z(S.checked)}),Q.addEventListener("click",async()=>{const e=b.value.trim();if(!e){v.textContent="Please enter a token.",v.style.color="#ff5630",v.style.display="block";return}await N.set({github_pat:e}),v.textContent="✅ Token saved!",v.style.color="#36b37e",v.style.display="block",setTimeout(()=>{v.style.display="none"},2500)}),chrome.storage.onChanged.addListener((e,t)=>{t==="local"&&st(e,{includeMeta:!0})&&(clearTimeout(R),R=setTimeout(()=>{C()},120))});try{O=await H.getHost()}catch(e){console.error(e)}await C(),await Z()});
