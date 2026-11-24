import { render, screen } from "@testing-library/react"
import { MessageContextMenu } from "./MessageContextMenu"

test("archived conversations keep own-message deletion but expose no writing actions", () => {
    render(
        <MessageContextMenu
            readOnly
            message={{ id: 1, me: true, text: "old message", data: 1 }}
            is_room={false}
            clientX={10}
            clientY={10}
            onReply={jest.fn()}
            onEdit={jest.fn()}
            onReact={jest.fn()}
            onDelete={jest.fn()}
            onSetPin={jest.fn()}
            onClose={jest.fn()}
        />
    )
    expect(screen.getByRole("menuitem", { name: "Удалить у всех" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Ответить" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Изменить" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Закрепить" })).not.toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Реакция" })).not.toBeInTheDocument()
})
