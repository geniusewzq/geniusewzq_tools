import { app } from "../../../scripts/app.js";

console.log("[geniusewzq] v1.3.0 loaded: FastGroupsBypasser");

app.registerExtension({
    name: "Geniusewzq.FastGroupsBypasser",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "FastGroupsBypasser") {
            
            nodeType.prototype.onNodeCreated = function() {
                this.serialize_widgets = true;
                // 设置初始大小
                this.setSize([280, 150]); 
            };

            const getNodesInGroup = (group) => {
                if (group._nodes && group._nodes.length > 0) return group._nodes;
                const nodes = app.graph._nodes;
                return nodes.filter(node => (
                    node.pos[0] >= group.pos[0] &&
                    node.pos[1] >= group.pos[1] &&
                    node.pos[0] + node.size[0] <= group.pos[0] + group.size[0] &&
                    node.pos[1] + node.size[1] <= group.pos[1] + group.size[1]
                ));
            };

            nodeType.prototype.onDrawForeground = function(ctx) {
                if (this.flags.collapsed) return;
                const groups = app.graph._groups;
                if (!groups || groups.length === 0) {
                    ctx.fillStyle = "#666";
                    ctx.font = "12px Arial";
                    ctx.fillText("未发现分组", 10, 30);
                    return;
                }

                let y = 30; // 第一个按钮的位置
                const margin = 10;
                const btnHeight = 35;
                const btnWidth = this.size[0] - 20;

                groups.forEach((group, index) => {
                    const nodesInGroup = getNodesInGroup(group);
                    const isBypassed = nodesInGroup.length > 0 && nodesInGroup[0].mode === 4;

                    // 绘制按钮背景
                    ctx.fillStyle = isBypassed ? "#353535" : "#444"; 
                    ctx.strokeStyle = isBypassed ? "#800080" : "#00FF00";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(margin, y - 20, btnWidth, btnHeight, [6]);
                    else ctx.rect(margin, y - 20, btnWidth, btnHeight);
                    ctx.fill();
                    ctx.stroke();

                    // 绘制组名
                    ctx.fillStyle = "#FFF";
                    ctx.font = "bold 13px Arial";
                    ctx.fillText(group.title || `组 ${index}`, margin + 38, y + 2);
                    
                    // 绘制圆形指示灯
                    ctx.fillStyle = isBypassed ? "#800080" : "#00FF00";
                    ctx.beginPath();
                    ctx.arc(margin + 20, y - 2, 7, 0, Math.PI * 2);
                    ctx.fill();

                    // 绘制状态文字
                    ctx.fillStyle = isBypassed ? "#888" : "#BBB";
                    ctx.font = "10px Arial";
                    ctx.fillText(isBypassed ? "BYPASS" : "ACTIVE", margin + btnWidth - 55, y + 2);

                    y += (btnHeight + 8); // 计算下一个按钮的间距
                });

                // 自动撑开节点的高度
                if (Math.abs(this.size[1] - (y + 10)) > 5) this.size[1] = y + 10;
            };

            nodeType.prototype.onMouseDown = function(e, pos) {
                // 点击判定逻辑
                if (pos[1] > 10) {
                    const index = Math.floor((pos[1] - 10) / 43); 
                    const groups = app.graph._groups;
                    if (groups && groups[index]) {
                        const nodes = getNodesInGroup(groups[index]);
                        if (nodes.length > 0) {
                            const newMode = (nodes[0].mode === 4) ? 0 : 4;
                            nodes.forEach(n => n.mode = newMode);
                            app.graph.setDirtyCanvas(true, true);
                        }
                        return true; 
                    }
                }
            };
        }
    }
});