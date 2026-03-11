import{s as n}from"./storage.js";const y={el:null,backdrop:null,currentKey:null,saveTimeout:null,async initIndicators(){const t=document.querySelectorAll(".et-notes-btn:not(.et-indicator-checked), .et-ticket-notes-toggle:not(.et-indicator-checked)");if(t.length===0)return;const s=new Set;if(t.forEach(r=>{r.classList.add("et-indicator-checked");const a=r.getAttribute("data-issue-key");a&&s.add(a)}),s.size===0)return;const e=[];s.forEach(r=>{const a=r.includes(":")?r:`jira:${r}`;e.push(`notes_${a}`,`reminder_${a}`)});const i=await n.get(e);s.forEach(r=>{const a=r.includes(":")?r:`jira:${r}`,c=!!i[`notes_${a}`],o=!!i[`reminder_${a}`];if(c||o){const u=r.split(":").pop();document.querySelectorAll(`[data-issue-key="${u}"], [data-issue-key="jira:${u}"]`).forEach(d=>{if(d.classList.contains("et-ticket-notes-toggle")){const h=d.querySelector("span");h&&(h.textContent="Personal notes ●")}else d.classList.add("has-note")})}})},init(){if(this.el)return;this.backdrop=document.createElement("div"),this.backdrop.className="et-drawer-backdrop",this.backdrop.onclick=()=>this.close(),this.el=document.createElement("div"),this.el.className="et-drawer",this.el.innerHTML=`
            <div class="et-drawer-header">
                <div>
                    <h2 class="et-drawer-title">📝 Note: <span id="et-drawer-key">---</span></h2>
                    <div id="et-drawer-summary" style="font-size: 13px; color: #6b778c; margin-top: 4px; font-weight: 500; line-height: 1.4;"></div>
                </div>
                <button class="et-drawer-close">×</button>
            </div>
            <div class="et-drawer-content">
                <div class="et-drawer-section">
                    <label class="et-drawer-label">Personal Notes</label>
                    <textarea class="et-drawer-textarea" placeholder="Type your notes here..."></textarea>
                </div>
                <div class="et-drawer-section">
                    <label class="et-drawer-label">Reminder</label>
                    <div class="et-drawer-reminder-row">
                        <span>🔔</span>
                        <input type="datetime-local" class="et-drawer-reminder-input">
                    </div>
                    <div class="et-drawer-shortcuts">
                        <button class="et-shortcut-btn" data-time="1h">1 Hr</button>
                        <button class="et-shortcut-btn" data-time="2h">2 Hrs</button>
                        <button class="et-shortcut-btn" data-time="tomorrow">Tomorrow 9am</button>
                        <button class="et-shortcut-btn" data-time="2days">2 Days 9am</button>
                    </div>
                </div>
            </div>
            <div class="et-drawer-footer">
                <button class="et-drawer-save">Save Note</button>
                <span class="et-drawer-status">✓ Saved</span>
                <button class="et-drawer-delete">Delete</button>
            </div>
        `,document.body.appendChild(this.backdrop),document.body.appendChild(this.el),this.el.querySelector(".et-drawer-close").onclick=()=>this.close(),this.el.querySelector(".et-drawer-save").onclick=()=>{this.save(),this.close(!0)},this.el.querySelector(".et-drawer-delete").onclick=()=>this.delete();const t=this.el.querySelector(".et-drawer-textarea"),s=this.el.querySelector(".et-drawer-reminder-input");t.oninput=()=>{clearTimeout(this.saveTimeout),this.saveTimeout=setTimeout(()=>this.save(),500)},s.onchange=()=>this.save(),this.el.querySelectorAll(".et-shortcut-btn").forEach(e=>{e.onclick=()=>{const i=e.getAttribute("data-time");this.applyShortcut(i)}}),window.addEventListener("keydown",e=>{e.key==="Escape"&&this.el.classList.contains("visible")&&this.close()})},applyShortcut(t){const s=new Date;let e=new Date(s);t==="1h"?e.setHours(s.getHours()+1):t==="2h"?e.setHours(s.getHours()+2):t==="tomorrow"?(e.setDate(s.getDate()+1),e.setHours(9,0,0,0)):t==="2days"&&(e.setDate(s.getDate()+2),e.setHours(9,0,0,0));const i=this.el.querySelector(".et-drawer-reminder-input"),r=e.getTimezoneOffset()*6e4,a=new Date(e.getTime()-r).toISOString().slice(0,16);i.value=a,this.save()},async open(t,s){this.init(),this.currentKey=t,this.el.querySelector("#et-drawer-key").textContent=t,this.el.querySelector("#et-drawer-summary").textContent=s||"";const e=this.el.querySelector(".et-drawer-textarea"),i=this.el.querySelector(".et-drawer-reminder-input");e.value="",i.value="";const r=t.includes(":")?t:`jira:${t}`,a=`notes_${r}`,c=`reminder_${r}`,o=await n.get([a,c]);if(this.currentKey===t){if(o[a]&&(e.value=o[a]),o[c]){const l=new Date(o[c]),u=l.getTimezoneOffset()*6e4,d=new Date(l.getTime()-u).toISOString().slice(0,16);i.value=d}this.backdrop.classList.add("visible"),this.el.classList.add("visible"),setTimeout(()=>e.focus(),350)}},close(t=!1){this.el&&(this.el.classList.remove("visible"),this.backdrop.classList.remove("visible"),clearTimeout(this.saveTimeout),t||this.save())},async delete(){if(!this.currentKey||!confirm("Are you sure you want to delete this note and reminder?"))return;const t=this.currentKey.includes(":")?this.currentKey:`jira:${this.currentKey}`,s=`notes_${t}`,e=`reminder_${t}`,i=`ignored_${t}`;await n.remove([s,e,i]),this.el.querySelector(".et-drawer-textarea").value="",this.el.querySelector(".et-drawer-reminder-input").value="",this.updateIndicators(!1),this.close(!0)},async save(){if(!this.currentKey)return;const t=this.el.querySelector(".et-drawer-textarea"),s=this.el.querySelector(".et-drawer-reminder-input"),e=this.el.querySelector(".et-drawer-status"),i=t.value.trim(),r=s.value,a=this.currentKey.includes(":")?`notes_${this.currentKey}`:`notes_jira:${this.currentKey}`,c=this.currentKey.includes(":")?`reminder_${this.currentKey}`:`reminder_jira:${this.currentKey}`,o=this.currentKey.includes(":")?this.currentKey:`jira:${this.currentKey}`;if(i?await n.set({[a]:i}):await n.remove(a),r){const l=new Date(r).getTime();await n.set({[c]:l}),await n.remove(`ignored_${o}`)}else await n.remove(c),await n.remove(`ignored_${o}`);e.classList.add("show"),setTimeout(()=>e.classList.remove("show"),1500),this.updateIndicators(i||r)},updateIndicators(t){const s=this.currentKey.split(":").pop();document.querySelectorAll(`[data-issue-key="${s}"], [data-issue-key="jira:${s}"]`).forEach(e=>{e.classList.contains("et-ticket-notes-toggle")?e.querySelector("span").textContent=t?"Personal notes ●":"Personal notes":t?e.classList.add("has-note"):e.classList.remove("has-note")})}};export{y as N};
