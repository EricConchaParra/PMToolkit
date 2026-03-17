import"./assets/modulepreload-polyfill.js";import{p as Y,c as Z,h as it,m as rt,a as lt,e as g,g as P,b as K,d as O,f as ct,i as dt,j as ut,n as gt}from"./assets/tagEditor.js";import{s as c,a as A}from"./assets/storage.js";const R={async getHost(){const d=await c.get(["et_jira_host"]);return d.et_jira_host?d.et_jira_host:window.location.hostname&&window.location.hostname.endsWith(".atlassian.net")?window.location.hostname:"jira.atlassian.net"},async fetchIssueDetails(d){var l,v,T,j,_,L,B,$;const h=await this.getHost(),r=d.split(":").pop();try{const w=await fetch(`https://${h}/rest/api/2/issue/${r}?fields=summary,assignee,status`,{credentials:"include"});if(!w.ok)return null;const C=await w.json();return{summary:((l=C.fields)==null?void 0:l.summary)||"",assignee:((T=(v=C.fields)==null?void 0:v.assignee)==null?void 0:T.displayName)||"Unassigned",status:{name:((_=(j=C.fields)==null?void 0:j.status)==null?void 0:_.name)||"Unknown",category:(($=(B=(L=C.fields)==null?void 0:L.status)==null?void 0:B.statusCategory)==null?void 0:$.key)||"new"}}}catch(w){return console.error("PMsToolKit: API fetch error",w),null}},async getBoardIdForProject(d){var h,r;try{const l=await fetch(`${window.location.origin}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(d)}&type=scrum&maxResults=1`,{credentials:"same-origin",headers:{Accept:"application/json"}});return l.ok&&((r=(h=(await l.json()).values)==null?void 0:h[0])==null?void 0:r.id)||null}catch(l){return console.error("PMsToolKit: Board fetch error",l),null}},async getLastClosedSprints(d,h=3){try{const r=await fetch(`${window.location.origin}/rest/agile/1.0/board/${d}/sprint?state=closed&maxResults=50`,{credentials:"same-origin",headers:{Accept:"application/json"}});return r.ok?((await r.json()).values||[]).slice(-h):[]}catch(r){return console.error("PMsToolKit: Sprints fetch error",r),[]}}},pt={jira_hide_elements:!0,jira_collapse_sidebar:!0,jira_manual_menu:!0,jira_copy_for_slack:!0,jira_quick_notes_list:!0,jira_quick_notes_ticket:!0,jira_breadcrumb_copy:!0,jira_age_indicators:!0,jira_board_age:!0,jira_sp_summary:!0,jira_native_table_icons:!0,zoom_copy_transcript:!0,github_pr_link:!1};document.addEventListener("DOMContentLoaded",async()=>{const d=document.getElementById("notes-view"),h=document.getElementById("settings-view"),r=document.getElementById("settings-toggle"),l=document.getElementById("sync-notes-btn"),v=document.getElementById("view-title"),T=document.getElementById("notes-list"),j=document.getElementById("notes-count"),_=document.getElementById("search"),L=document.getElementById("tag-filter-host"),B=document.getElementById("test-notification-btn"),$=document.getElementById("notif-status"),w=document.getElementById("github-pr-link-toggle"),C=document.getElementById("github-pat-section"),U=document.getElementById("github-pat-input"),tt=document.getElementById("github-pat-save-btn"),k=document.getElementById("github-pat-status");let z=[],D=!1,F="jira.atlassian.net",b={},S=[],p=null,V=null;function M(e){D||(v.textContent=e)}function et(e=[],t=""){const s=ct(e,b);return s.length?`
            <div class="et-tag-read-list ${t}">
                ${s.map(n=>`
                    <span class="et-tag-chip" style="${dt(n.color)}">
                        <span class="et-tag-chip-dot"></span>
                        <span class="et-tag-chip-label">${g(n.label)}</span>
                    </span>
                `).join("")}
            </div>
        `:""}function H(){const e=z.filter(t=>rt(t,_.value)&&lt(t.tags,S));st(e)}async function I(){const e=await c.getAll(),t=Y(e),s={...t.metaMap};b=t.tagDefs;const n=t.allKeys.filter(a=>!s[a]||!s[a].status);if(n.length>0){M("⏳ Loading info...");for(const a of n){const y=await R.fetchIssueDetails(a);y&&(s[a]={summary:y.summary,assignee:y.assignee,status:y.status},await c.set({[`meta_jira:${a}`]:s[a]}))}M("📝 My Notes")}z=t.allKeys.map(a=>({key:a,text:t.notesMap[a]||"",reminder:t.remindersMap[a]||null,tags:t.tagsMap[a]||[],meta:s[a]||null})).sort((a,y)=>y.key.localeCompare(a.key)),p==null||p.setTagDefs(b),S=(p==null?void 0:p.getValue())||S,H()}function st(e){if(T.innerHTML="",j.textContent=e.length,e.length===0){const t=!!(_.value.trim()||S.length);T.innerHTML=`
                <div class="empty-state">
                    <div class="emoji">${t?"🔎":"📝"}</div>
                    <p>${t?"No notes, reminders or tags match your filters.":"No notes, reminders or tags found."}</p>
                </div>
            `;return}e.forEach(t=>{const s=document.createElement("div");s.className="note-item";function n(){const y=t.reminder&&t.reminder<Date.now(),N=t.reminder?`
                    <div class="note-reminder-badge ${y?"overdue":"future"}">
                        <span>🔔</span> ${g(new Date(t.reminder).toLocaleString())}
                    </div>
                `:"",x=t.meta?t.meta.summary:"No summary loaded",E=t.meta?t.meta.assignee:"Unknown assignee",i=t.meta?t.meta.status:null;let o="";if(i){const m=i.name.toLowerCase();m.includes("blocked")||m.includes("hold")?o="status-blocked":m.includes("review")||m.includes("reviewing")?o="status-inreview":m.includes("qa")||m.includes("test")?o="status-qa":(m.includes("in progress")||m.includes("progress"))&&(o="status-inprogress-specific")}const u=i?`
                    <div class="note-status-badge status-${g(i.category)} ${o}">${g(i.name)}</div>
                `:"",q=F;s.innerHTML=`
                    <div class="note-header">
                        <a href="https://${q}/browse/${t.key}" target="_blank" class="note-key">${g(t.key)}</a>
                        <div class="note-actions">
                            <button class="icon-only edit-btn" title="Edit note">✏️</button>
                            <button class="icon-only copy-btn" title="Copy Link for Slack">🔗</button>
                            <button class="icon-only delete-btn" title="Delete tracked item">🗑️</button>
                        </div>
                    </div>
                    <div class="note-meta">
                        <div class="note-meta-top">
                            ${u}
                            <div class="note-summary" title="${g(x)}">${g(x)}</div>
                        </div>
                        <div class="note-meta-bottom">
                            👤 ${g(E)}
                        </div>
                    </div>
                    ${et(t.tags,"popup-note-tags")}
                    ${t.text?`<div class="note-text">${g(t.text)}</div>`:""}
                    ${N}
                `,s.querySelector(".edit-btn").onclick=a,s.querySelector(".copy-btn").onclick=m=>{const f=m.currentTarget;if(f.dataset.isCopying)return;f.dataset.isCopying="true";const J=`https://${q}/browse/${t.key}`,W=`${t.key} - ${x}`,at=`<a href="${J}">${g(W)}</a>`,Q=`[${W}](${J})`,X=f.textContent,ot=[new ClipboardItem({"text/plain":new Blob([Q],{type:"text/plain"}),"text/html":new Blob([at],{type:"text/html"})})];navigator.clipboard.write(ot).then(()=>{f.textContent="✅",setTimeout(()=>{f.textContent=X,delete f.dataset.isCopying},1500)}).catch(()=>{navigator.clipboard.writeText(Q).then(()=>{f.textContent="✅",setTimeout(()=>{f.textContent=X,delete f.dataset.isCopying},1500)}).catch(()=>{delete f.dataset.isCopying})})},s.querySelector(".delete-btn").onclick=async()=>{confirm(`Delete note, reminder, and tags for ${t.key}?`)&&(await c.remove([P(t.key),K(t.key),O(t.key)]),await I())}}function a(){const y=i=>{if(!i)return"";const o=new Date(i);return o.setMinutes(o.getMinutes()-o.getTimezoneOffset()),o.toISOString().slice(0,16)};let N=t.tags.slice();s.innerHTML=`
                    <div class="popup-edit-card">
                        <div class="note-header popup-edit-header">
                            <span class="note-key">${g(t.key)}</span>
                        </div>
                        <textarea class="edit-note-text popup-edit-text"></textarea>
                        <div class="popup-edit-field">
                            <label>Reminder</label>
                            <input type="datetime-local" class="edit-reminder-input popup-edit-reminder" value="${y(t.reminder)}">
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
                `;const x=s.querySelector(".edit-note-text");x.value=t.text||"";const E=Z(s.querySelector(".popup-edit-tags-host"),{value:t.tags,tagDefs:b,placeholder:"Add or create tags...",onCreateTag:async(i,o)=>{const u=await ut(i,o);return u?(b={...b,[u.normalized]:{label:u.label,color:u.color}},p==null||p.setTagDefs(b),E.setTagDefs(b),u):!1},onChange:i=>{N=i.slice()}});s.querySelector(".cancel-edit-btn").onclick=()=>{E.destroy(),n()},s.querySelector(".save-edit-btn").onclick=async()=>{const i=x.value.trim(),o=s.querySelector(".edit-reminder-input").value,u=gt(N,b);if(i?await c.set({[P(t.key)]:i}):await c.remove(P(t.key)),o){const q=new Date(o).getTime();await c.set({[K(t.key)]:q})}else await c.remove(K(t.key));u.length?await c.set({[O(t.key)]:u}):await c.remove(O(t.key)),t.text=i,t.reminder=o?new Date(o).getTime():null,t.tags=u,E.destroy(),await I()}}n(),T.appendChild(s)})}r.addEventListener("click",()=>{D=!D,D?(d.style.display="none",h.style.display="block",v.textContent="⚙️ Settings",r.textContent="📝"):(d.style.display="block",h.style.display="none",v.textContent="📝 My Notes",r.textContent="⚙️")}),document.getElementById("open-exporter-btn").addEventListener("click",()=>{const e=chrome.runtime.getURL("src/pages/analytics/index.html");chrome.tabs.create({url:e})}),l.addEventListener("click",async()=>{if(l.classList.contains("syncing-spin"))return;l.classList.add("syncing-spin"),M("⏳ Syncing statuses...");const e=await c.getAll(),t=Y(e);for(const s of t.allKeys)try{const n=await R.fetchIssueDetails(s);if(!n)continue;await c.set({[`meta_jira:${s}`]:{summary:n.summary,assignee:n.assignee,status:n.status}})}catch(n){console.warn(`Failed to sync details for ${s}`,n)}l.classList.remove("syncing-spin"),M("📝 My Notes"),await I()}),_.addEventListener("input",H);async function nt(){const e=await A.get(pt);document.querySelectorAll("input[data-setting]").forEach(s=>{const n=s.getAttribute("data-setting");Object.prototype.hasOwnProperty.call(e,n)&&(s.checked=e[n])});const t=e.github_pr_link===!0;if(G(t),t){const s=await A.get({github_pat:""});s.github_pat&&(U.value=s.github_pat)}}document.querySelectorAll("input[data-setting]").forEach(e=>{e.addEventListener("change",async()=>{const t=e.getAttribute("data-setting");await A.set({[t]:e.checked})})}),B.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"TEST_NOTIFICATION"}),$.textContent="Test signal sent to background...",$.style.display="block",setTimeout(()=>{$.style.display="none"},3e3)});function G(e){C.style.display=e?"block":"none"}w.addEventListener("change",()=>{G(w.checked)}),tt.addEventListener("click",async()=>{const e=U.value.trim();if(!e){k.textContent="Please enter a token.",k.style.color="#ff5630",k.style.display="block";return}await A.set({github_pat:e}),k.textContent="✅ Token saved!",k.style.color="#36b37e",k.style.display="block",setTimeout(()=>{k.style.display="none"},2500)}),p=Z(L,{value:[],tagDefs:{},allowCreate:!1,compact:!0,placeholder:"Filter tags...",onChange:e=>{S=e.slice(),H()}}),chrome.storage.onChanged.addListener((e,t)=>{t==="local"&&it(e,{includeMeta:!0})&&(clearTimeout(V),V=setTimeout(()=>{I()},120))});try{F=await R.getHost()}catch(e){console.error(e)}await I(),await nt()});
