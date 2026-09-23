import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "geniusewzq.DynamicPromptChain",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "DynamicPromptChain") return;

        // 整理 input_ 端口：删除所有未连接的端口，重新命名，保证序号连续
        const reorderInputs = function () {
            // 1. 从后往前删除所有未连接的 input_ 端口（至少保留一个）
            //    从后往前是为了避免删除时索引变化导致的问题
            for (let i = this.inputs.length - 1; i >= 0; i--) {
                const input = this.inputs[i];
                if (!input || !input.name.startsWith("input_")) continue;
                if (input.link === null) {
                    // 检查是否还有其他 input_ 端口，至少保留一个
                    const otherCount = this.inputs.filter((inp, idx) =>
                        idx !== i && inp && inp.name.startsWith("input_")
                    ).length;
                    if (otherCount > 0) {
                        this.removeInput(i);
                    }
                }
            }

            // 2. 重新命名所有 input_ 端口，保证序号连续（input_1, input_2, ...）
            let counter = 1;
            for (let i = 0; i < this.inputs.length; i++) {
                const input = this.inputs[i];
                if (input && input.name.startsWith("input_")) {
                    input.name = `input_${counter}`;
                    counter++;
                }
            }

            // 3. 如果最后一个 input_ 端口已连接，添加新的空端口
            const lastInput = this.inputs[this.inputs.length - 1];
            if (lastInput && lastInput.name.startsWith("input_") && lastInput.link !== null) {
                this.addInput(`input_${counter}`, "STRING");
            }

            // 4. 如果没有任何 input_ 端口（理论上不会发生），添加一个
            const hasInputPort = this.inputs.some(inp => inp && inp.name.startsWith("input_"));
            if (!hasInputPort) {
                this.addInput("input_1", "STRING");
            }

            // 5. 把 clip 端口移到最上方（clip 在上，input_* 在下）
            const clipIndex = this.inputs.findIndex(inp => inp && inp.name === "clip");
            if (clipIndex > 0) {
                const clipInput = this.inputs.splice(clipIndex, 1)[0];
                this.inputs.unshift(clipInput);
            }

            this.setSize([this.size[0], this.computeSize()[1]]);
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected) {
            if (onConnectionsChange) onConnectionsChange.apply(this, arguments);

            if (type !== 1) return; // 仅处理输入端

            const inputName = this.inputs[index]?.name || "";
            if (!inputName.startsWith("input_")) return;

            // 无论是连接还是断开，都重新整理端口
            reorderInputs.call(this);
        };

        // 处理复制粘贴场景：清理多余的未连接端口
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);

            // 延迟执行，确保节点完全加载（包括从工作流恢复的端口）
            setTimeout(() => {
                reorderInputs.call(this);
            }, 100);
        };
    },
});
